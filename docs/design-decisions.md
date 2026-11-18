# Design decisions

Decisions made while designing the domain schema (W1-04). They refine or override the project plan, and they feed into `DESIGN.md` (W4-06). Test cases for these rules are in [test-scenarios.md](test-scenarios.md).

## Schema

- Cycle times live in `MachineCapability`, with one row per machine and capability.
- Routing candidates live in `RoutingCandidate`, with one row per machine per decision. Values are a snapshot from when the decision was made.
- `Job` links to `RoutingDecision`, and the order is reached through the decision. The link is not unique, so one decision can own several jobs if order splitting is added later.
- An order can have many jobs over time. Its current job is worked out from job status.
- `seq` and `lastSeq` are `BigInt`.
- The orders table is named `orders`, because `order` is a reserved word in SQL.

## No double-booking (rule 1)

The database itself refuses to double-book a machine, so the rule holds even if application code is wrong or two requests arrive at the same moment. The `job` table is the reservation table: every active job holds its time slot.

- **`job_no_overlap`** is an exclusion constraint: no two jobs on the same machine may have overlapping `[planned_start, planned_end)` ranges. It uses the `btree_gist` extension and is written in hand-made SQL, because Prisma cannot describe it.
- **Only `PLANNED` and `RUNNING` jobs count.** Released, cancelled and complete jobs stay as history without blocking the slot. The list lives in two places, the constraint's `WHERE` clause and `ACTIVE_JOB_STATUSES` in `jobs.model.ts`, and they must match.
- **Ranges are half-open**, so a job may start exactly when another ends. Routing's gap search uses the same convention.
- **`job_planned_end_after_start`** requires a job to take some time, because a zero-length range overlaps nothing and would slip past the overlap check.
- The constraint also applies to updates, such as making a cancelled job active again.
- Prisma ignores both constraints: `prisma migrate dev` doesn't try to drop them, and the drift check still passes.
- **How the error arrives:** Prisma has no code of its own for it. It comes as a generic `PrismaClientKnownRequestError` (code `P2039`), with Postgres code `23P01` nested in `meta.driverAdapterError.cause`. `isJobOverlapError` in `errors/database-errors.ts` recognises it, so a collision can become a 409 instead of a 500.

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

Implemented as a pure function, `routeOrder` in `apps/backend/src/domain/routing.ts`: it reads nothing from the database or the clock, so the same input always gives the same decision.

- Earliest start is the **earliest gap long enough for the job**, not the end of the last reservation as the plan says. This lets freed slots be reused.
- **No job starts before `now + approval window`.** The window is `APPROVAL_WINDOW_SECONDS` real seconds (default 120), converted to simulated time with the clock scale, so 120 simulated minutes at 60x. Without it, a proposal would expire while the operator reads it.
- **Production time** is quantity × the sum of the machine's cycle times for every required capability, because the operations run one after another.
- **Each machine gets the first rejection reason that applies**, in this order: rejected by the operator, missing a capability, site down, machine in `ERROR` or `OFFLINE`, no shipping route to the destination, misses the deadline. A machine that is `RUNNING` is still a candidate; its bookings decide when it is free.
- **Ranking:** most slack (deadline minus arrival), then the least loaded site, then machine id. Site load is the total booked minutes still ahead on the site's machines, so a 10-hour job counts more than a 10-minute one.
- Machines that miss the deadline keep their timing in the decision, so the explanation can say how late they would be.
- Machines already rejected for an order are excluded when that order is routed again, with the rejection reason `REJECTED_BY_OPERATOR`.
- A failed routing attempt still stores a decision with its candidates and reasons, using `NO_ELIGIBLE_MACHINE`.
- When a blocked order is retried **automatically** (after a machine recovers, W3-06), a new decision is stored only if a machine is found. A manual retry through the API always stores its decision, because the operator asked for it.
- An order becomes `BLOCKED` when no single machine has every required capability, when every capable machine or site is unavailable, or when every remaining candidate misses the deadline.
- An order whose deadline can no longer be met stays `BLOCKED`, because editing orders is out of scope for v1.
- **v1 routes each order to a single machine** (rule 2). Splitting an order's operations across several machines is a possible extension, but it turns routing into scheduling a chain of jobs, with transfers between sites and failures mid-chain.

### Routing an order through the API

`POST /api/orders/:id/route` (in `services/routing.service.ts`) does everything in **one transaction**: lock the order, load the data, run `routeOrder`, save the decision with all candidates, book the job, and update the order. Either all of it is saved or none of it.

- **Only `DRAFT` and `BLOCKED` orders can be routed.** Any other status returns 409.
- **The order's row is locked** (`SELECT ... FOR UPDATE`) for the whole transaction, so two route requests for the same order run one after the other, and the second gets 409.
- **When two different orders grab the same slot,** the second job insert hits `job_no_overlap`, everything rolls back, and routing runs again with fresh data. After 5 attempts (one try plus 4 retries) the request returns 409, with nothing saved, and the order can simply be routed again.
- **Concurrency is optimistic, and that has a cost under bursts.** Routing is deterministic, so requests that read the schedule at the same moment all pick the same slot, and each round only one of them wins. In a deliberate worst case (10 to 20 requests fired at exactly the same moment, W2-06), about half of the requests gave up with 409 (53 of 100 with 4 retries; the exact number varies with timing). No data was ever wrong. Operators clicking by hand rarely collide like this. If bursts become common, the alternative is to make routing requests take turns with a database advisory lock, keeping the constraint as a safety net; a good point for `DESIGN.md` and for scaling to 100 sites.
- **Stress tests check the whole database, not just responses.** `test/concurrency.test.ts` routes, approves and rejects many orders at once over several rounds, then runs `findInconsistencies` (in `test/helpers/consistency.ts`): no overlapping active jobs, one booked job per proposal, one proposal per order waiting for approval, and every order's status matching its newest decision. With the `job_no_overlap` constraint removed, every stress test fails with overlapping jobs.
- The lock and the constraint overlap for the common case: when two requests for one order compute the same slot, the second collides, retries, and then sees the order is `ROUTED`. The lock is still needed for a rarer timing, where the second request reads the order before the first commits but reads the bookings after. It would then pick a different free slot, and the order would be booked twice.
- The approval window is converted to simulated time here: `APPROVAL_WINDOW_SECONDS` × 1000 × the clock's scale.
- Transactions have an explicit timeout of 10 seconds and wait at most 5 seconds for a connection, instead of Prisma's defaults.
- Candidates store `arrival_at` as well as start and finish, so screens can show when each machine's parts would arrive.

## Proposals and approval

- Every proposal, including a reroute, books its slot immediately as a `PLANNED` job. The exclusion constraint then makes collisions impossible. The cost is that unapproved proposals hold machine time.
- The dispatcher only starts jobs whose decision is `APPROVED`.
- Approve only updates a decision that is still `PROPOSED`, so repeating it has no effect.
- A proposal still unapproved at its `plannedStart` becomes `EXPIRED`.
- When a proposal is rejected or expires, its job becomes `CANCELLED`, the order returns to `DRAFT`, and the slot is free immediately. Routing again is the operator's choice.
- Other jobs never move earlier or later to fill a gap, because their times were approved.

### Approving and rejecting through the API

`POST /api/decisions/:id/approve` and `POST /api/decisions/:id/reject` (in `services/decisions.service.ts`) work the same for first proposals and reroutes.

| Action           | Decision                                            | Job                     | Order                                      |
| ---------------- | --------------------------------------------------- | ----------------------- | ------------------------------------------ |
| Approve          | `PROPOSED` → `APPROVED`                             | stays `PLANNED`         | `ROUTED` or `REROUTE_PENDING` → `APPROVED` |
| Reject           | `PROPOSED` → `REJECTED`, with the operator's reason | `PLANNED` → `CANCELLED` | → `DRAFT`                                  |
| Approve too late | `PROPOSED` → `EXPIRED`                              | `PLANNED` → `CANCELLED` | → `DRAFT`                                  |

- **Rejecting requires a reason** (1–500 characters), saved as `rejectionNote` on the decision. It is the operator's own words, separate from the machine-level rejection reasons on candidates.
- **Approving after the job's planned start has passed** expires the proposal on the spot and returns 409. The expiry is saved even though the request fails: the transaction returns an "expired" result, and the 409 is raised only after it commits. The background sweep (W3-09) does the same for proposals nobody touches.
- **Approval rechecks what it confirms.** It returns 409, and changes nothing, if the proposal has no booked (`PLANNED`) job, if the booked machine is now `ERROR` or `OFFLINE`, or if its site is `DOWN` (rule 3). The operator then rejects the proposal and routes the order again. A `RUNNING` machine is fine: it is only busy with other work.
- **Routing fails loudly** if it ever chose a machine without a time slot, instead of saving a proposal that books nothing.
- **Repeating the same action is harmless:** approving an approved decision, or rejecting a rejected one, returns 200 with the current state. The first rejection reason is kept. A conflicting action, such as approving a rejected decision, returns 409.
- **An order's current decision is its newest one.** After an approved reroute, an order has two `APPROVED` decisions: the original, whose job is now `RELEASED`, and the reroute. Both are historically true, so neither is changed; screens show the newest decision as current and the rest as history.
- **Two layers stop approve and reject from both winning:** the order row is locked for the whole transaction, and the decision only changes if its status is still the one that was read. Removing both lets a concurrent approve and reject both succeed; a test runs six such races at once to catch that.

## Status changes

`domain/order-status.ts` lists every allowed status change, and every service checks it before saving. An impossible change, such as `COMPLETE` back to `DRAFT`, is refused with 409 wherever it is attempted.

| Order status      | May become                                        | Triggered by                                      |
| ----------------- | ------------------------------------------------- | ------------------------------------------------- |
| `DRAFT`           | `ROUTED`, `BLOCKED`                               | Routing                                           |
| `BLOCKED`         | `ROUTED`, `BLOCKED`                               | Retrying by hand, or after a machine recovers     |
| `ROUTED`          | `APPROVED`; `DRAFT`; `REROUTE_PENDING`, `BLOCKED` | Approve; reject or expire; proposed machine fails |
| `APPROVED`        | `IN_PRODUCTION`; `REROUTE_PENDING`, `BLOCKED`     | Job starts; machine fails                         |
| `IN_PRODUCTION`   | `COMPLETE`; `REROUTE_PENDING`, `BLOCKED`          | Job completes; machine fails mid-job              |
| `REROUTE_PENDING` | `APPROVED`; `DRAFT`; `REROUTE_PENDING`, `BLOCKED` | Approve; reject or expire; new machine fails too  |
| `COMPLETE`        | nothing                                           | Final                                             |

A decision is decided exactly once: `PROPOSED` may become `APPROVED`, `REJECTED`, `EXPIRED` or `SUPERSEDED`, and every other decision status is final.

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

## Time

The demo runs on a simulated clock that is faster than real time, set by `CLOCK_SCALE` (default 60, so a 30-minute job takes 30 real seconds). It starts at the real time when the process starts.

- **The rule: anything stored or compared uses simulated time.** That covers deadlines, planned job times, `createdAt`, `receivedAt` and `lastHeartbeatAt`, plus every comparison: deadlines, dispatching, expiry and heartbeat timeouts.
- **Real time is used only for** how often background loops run, and for log timestamps.
- Database columns have no `now()` defaults, so the app always passes `clock.now()`. A forgotten time is a type error, not a silently wrong value.
- A heartbeat timeout is defined in heartbeats (for example, 3 missed) and converted to simulated time with the scale, so the comparison uses two simulated times.
- "Deadline must be in the future" is checked in the backend with the clock, not in the shared schema, which only checks the date's format.
- **A restart moves the clock back** to the current real time, so jobs planned far ahead can end up far in the future. Reseed with `npm run db:seed` after restarting. Saving the clock's start in the database would avoid this, but is left out of v1 to keep it simple.
- Tests replace the clock with a manual one that only moves when the test moves it.

## Still open

- **`ACKED` triggers for `RESET` and `CANCEL_JOB` (W3):** the plan has no event type confirming either one.
