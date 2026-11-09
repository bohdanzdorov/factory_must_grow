# Design decisions

Decisions made while designing the domain schema (W1-04). They refine or override the project plan, and they feed into `DESIGN.md` (W4-06). Test cases for these rules are in [test-scenarios.md](test-scenarios.md).

## Schema

- Cycle times live in `MachineCapability`, with one row per machine and capability.
- Routing candidates live in `RoutingCandidate`, with one row per machine per decision. Values are a snapshot from when the decision was made.
- `Job` links to `RoutingDecision`, and the order is reached through the decision. The link is not unique, so one decision can own several jobs if order splitting is added later.
- An order can have many jobs over time. Its current job is worked out from job status.
- `seq` and `lastSeq` are `BigInt`.
- The orders table is named `orders`, because `order` is a reserved word in SQL.

## Status meanings

| Decision status       | Meaning                                              |
| --------------------- | ---------------------------------------------------- |
| `PROPOSED`            | Waiting for operator approval; its job holds a slot  |
| `APPROVED`            | Accepted by the operator                             |
| `REJECTED`            | Declined by the operator                             |
| `EXPIRED`             | Not approved by the job's `plannedStart`             |
| `SUPERSEDED`          | Replaced because its machine failed before approval  |
| `NO_ELIGIBLE_MACHINE` | Routing ran and found no machine; nothing to approve |

| Job status  | Meaning                                                 |
| ----------- | ------------------------------------------------------- |
| `PLANNED`   | Holds a slot on the machine                             |
| `RUNNING`   | In production                                           |
| `COMPLETE`  | Finished                                                |
| `RELEASED`  | Displaced by a failure; kept as history                 |
| `CANCELLED` | Never ran, because its proposal was rejected or expired |

## Routing

- Earliest start is the **earliest gap long enough for the job**, not the end of the last reservation as the plan says. This lets freed slots be reused.
- Machines already rejected for an order are excluded when that order is routed again, with the rejection reason `REJECTED_BY_OPERATOR`.
- A failed routing attempt still stores a decision with its candidates and reasons, using `NO_ELIGIBLE_MACHINE`.
- When a blocked order is retried, a new decision is stored only if a machine is found.
- An order becomes `BLOCKED` when no single machine has every required capability, when every capable machine or site is unavailable, or when every remaining candidate misses the deadline.
- An order whose deadline can no longer be met stays `BLOCKED`, because editing orders is out of scope for v1.

## Proposals and approval

- Every proposal, including a reroute, books its slot immediately as a `PLANNED` job. The exclusion constraint then makes collisions impossible. The cost is that unapproved proposals hold machine time.
- The dispatcher only starts jobs whose decision is `APPROVED`.
- Approve only updates a decision that is still `PROPOSED`, so repeating it has no effect.
- A proposal still unapproved at its `plannedStart` becomes `EXPIRED`.
- When a proposal is rejected or expires, its job becomes `CANCELLED`, the order returns to `DRAFT`, and the slot is free immediately. Routing again is the operator's choice.
- Other jobs never move earlier or later to fill a gap, because their times were approved.

## Commands

- Commands not yet acknowledged are resent in heartbeat responses. The simulator ignores command ids it has already seen.
- `START_JOB` becomes `ACKED` on `job_started`, and `FAIL` on `machine_failure`.
- Unfinished commands for a failed machine become `CANCELLED`.
- The dispatcher waits until a machine is `IDLE` before starting its next job.

## Events

- Only events use `seq`. Heartbeats do not, so a retried event cannot look stale because heartbeats moved the counter on.
- Events are sent in order.
- The simulator starts `seq` from `Date.now()`, so events after a restart are not treated as stale.
- Events for a job that is no longer `RUNNING` are stored but change nothing.

## Failure handling

A failure is handled in one transaction, triggered by a `machine_failure` event or by a missed-heartbeat timeout. It is safe to run twice.

1. Store the event. If it is a duplicate, stop and reply OK.
2. Set the machine to `ERROR`, or `OFFLINE` for a timeout.
3. Set the running job and all future `PLANNED` jobs on that machine to `RELEASED`.
4. Set open proposals on it to `SUPERSEDED`, and their jobs to `CANCELLED`.
5. Set its unfinished commands to `CANCELLED`.
6. Route each affected order, earliest deadline first. The order becomes `REROUTE_PENDING` with a new proposal, or `BLOCKED` with a reason.

If any step fails, everything rolls back and no acknowledgement is sent, so the retry runs it again.

- A machine that failed midway restarts the full quantity elsewhere. Partial progress is not modeled in v1.
- A machine marked `OFFLINE` may still be running, so it receives `CANCEL_JOB` when it reconnects.

## Site down

- An operator sets a site to `DOWN`. The backend sets all its machines to `OFFLINE` and handles the released work itself.
- `FAIL` is best-effort and sent only to `RUNNING` machines, because a site that is really down cannot receive commands.
- `Site.status` stays the gate for routing, so a machine's heartbeat cannot make it available while its site is down.

## Still open

- **Multi-capability cycle time (W2-01):** the suggested approach is to add up the machine's cycle times for each required capability.
- **`ACKED` triggers for `RESET` and `CANCEL_JOB` (W3):** the plan has no event type confirming either one.
