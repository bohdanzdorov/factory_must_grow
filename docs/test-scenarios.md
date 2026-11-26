# Test scenarios

Situations the system must handle, and the test that proves each one. The rules behind them are in [design-decisions.md](design-decisions.md). Test files are in `apps/backend/test/` unless they start with `simulator/`. A row marked **not covered** has no test yet; one marked with a task is for a feature that isn't built yet.

Many failure tests also check the whole database with `helpers/consistency.ts`, not just the responses: no overlapping jobs, no active job on a failed machine, one proposal per waiting order, every reroute linked to its own order, and so on.

## Routing

| Scenario                                  | Expected result                       | Covered by                                        |
| ----------------------------------------- | ------------------------------------- | ------------------------------------------------- |
| Parallel requests for the same slot       | Exactly one gets it, with no overlap  | `concurrency.test.ts`, `routing-endpoint.test.ts` |
| Two parallel route requests for one order | Only one proposal exists              | `routing-endpoint.test.ts`                        |
| Slot freed in the middle of a schedule    | The next order that fits uses the gap | `routing.test.ts`, `decisions.test.ts`            |
| No machine has every required capability  | `BLOCKED`, with a reason per machine  | `routing.test.ts`, `routing-endpoint.test.ts`     |
| Every candidate misses the deadline       | `BLOCKED`, with a reason per machine  | `routing.test.ts`                                 |
| Two machines tie on slack and site load   | The lower machine id wins, every time | `routing.test.ts`                                 |
| A machine fails while routing chooses it  | Routing notices and picks another     | `failure-races.test.ts`                           |

## Approval

| Scenario                                | Expected result                       | Covered by                                      |
| --------------------------------------- | ------------------------------------- | ----------------------------------------------- |
| Double-click approve                    | The second click changes nothing      | `decisions.test.ts`                             |
| Reject, then route again                | The rejected machine is excluded      | `decisions.test.ts`, `routing-endpoint.test.ts` |
| Reject, with no other machine available | `BLOCKED`, with a reason              | **not covered**                                 |
| Not approved by `plannedStart`          | `EXPIRED`, job `CANCELLED`, slot free | `decisions.test.ts`                             |
| Approve at the moment it expires        | Exactly one outcome wins              | **not covered** (W3-09)                         |
| `plannedStart` arrives before approval  | The dispatcher does not start the job | W3-09                                           |

## Events

| Scenario                                 | Expected result                   | Covered by                                                      |
| ---------------------------------------- | --------------------------------- | --------------------------------------------------------------- |
| Same event sent twice                    | The second has no effect          | `ingest.test.ts` (also two copies at the same moment)           |
| Older event arrives after a newer one    | State is not overwritten          | `ingest.test.ts`, `machine-failure.test.ts`, `recovery.test.ts` |
| Event retried after heartbeats continued | It is still processed             | `ingest.test.ts` (heartbeats don't move `lastSeq`)              |
| Simulator restarts                       | Its new events are still accepted | `simulator/transport/outbox.test.ts`, `ingest.test.ts`          |

## Commands

| Scenario                                  | Expected result                      | Covered by                                           |
| ----------------------------------------- | ------------------------------------ | ---------------------------------------------------- |
| Heartbeat response lost                   | Command resent, job started once     | `ingest.test.ts`, `simulator/simulator.test.ts`      |
| Machine fails with a command pending      | Command `CANCELLED`, never delivered | `reroute.test.ts`, `ingest.test.ts`                  |
| Machine still busy at next `plannedStart` | Start waits until it is `IDLE`       | `simulator/domain/machine.test.ts`; dispatcher W3-09 |

## Failure

| Scenario                                | Expected result                                                        | Covered by                                   |
| --------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------- |
| Machine fails mid-job                   | Job `RELEASED`, reroute proposed, slot held                            | `reroute.test.ts`                            |
| Same failure event sent twice           | Nothing changes the second time                                        | `reroute.test.ts`, `machine-failure.test.ts` |
| Machine with several future jobs fails  | All released, earliest deadline routed first                           | `reroute.test.ts`                            |
| Fails while a proposal on it is pending | `SUPERSEDED`, its hold cancelled                                       | `reroute.test.ts`                            |
| Crash midway through failure handling   | Full rollback, and the retry works                                     | `failure-races.test.ts`                      |
| Crash while rerouting one of many       | The others are rerouted; that one stays `BLOCKED` until the next retry | `failure-races.test.ts`                      |
| Reroute booking clashes                 | Only that order is redone                                              | `failure-races.test.ts`                      |
| No alternative machine                  | `BLOCKED` with a reason, job kept                                      | `reroute.test.ts`                            |
| Reroute approved                        | Work moves with no overlap, restarts in full                           | `failure-scenarios.test.ts`                  |
| Reroute rejected                        | Hold cancelled, order `DRAFT`                                          | `decisions.test.ts`                          |
| Failure during routing and approvals    | No work left on the failed machine, consistent                         | `concurrency.test.ts` (stress)               |
| The whole story, start to finish        | Consistent after every step                                            | `failure-scenarios.test.ts`                  |

## Offline and recovery

| Scenario                           | Expected result                                    | Covered by                                              |
| ---------------------------------- | -------------------------------------------------- | ------------------------------------------------------- |
| Heartbeats stop                    | `OFFLINE`, same reroute as a failure               | `machine-failure.test.ts`, `reroute.test.ts`            |
| Machine was actually still running | Late completion changes nothing, `CANCEL_JOB` sent | `CANCEL_JOB`: `reroute.test.ts`; late completion: W3-10 |
| Machine reset                      | Eligible again, `BLOCKED` orders retried           | `recovery.test.ts`                                      |
| Retry still finds no machine       | Order stays `BLOCKED`, no new decision stored      | `recovery.test.ts`                                      |

## Site down

| Scenario                                  | Expected result                       | Covered by                  |
| ----------------------------------------- | ------------------------------------- | --------------------------- |
| Site set down while unreachable           | Work rerouted without `FAIL` arriving | `recovery.test.ts`          |
| Heartbeat from a machine at a down site   | It stays unavailable                  | `recovery.test.ts`          |
| Failure arrives after a site already fell | Nothing is released twice             | `failure-scenarios.test.ts` |
