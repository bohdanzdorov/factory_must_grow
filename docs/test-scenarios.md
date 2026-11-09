# Test scenarios

Situations to verify once the matching features exist. The rules behind them are in [design-decisions.md](design-decisions.md).

## Routing

| Scenario                                  | Expected result                       |
| ----------------------------------------- | ------------------------------------- |
| Parallel requests for the same slot       | Exactly one gets it, with no overlap  |
| Two parallel route requests for one order | Only one proposal exists              |
| Slot freed in the middle of a schedule    | The next order that fits uses the gap |
| No machine has every required capability  | `BLOCKED`, with a reason per machine  |
| Every candidate misses the deadline       | `BLOCKED`, with a reason per machine  |
| Two machines tie on slack and site load   | The lower machine id wins, every time |

## Approval

| Scenario                                | Expected result                       |
| --------------------------------------- | ------------------------------------- |
| Double-click approve                    | The second click changes nothing      |
| Reject, then route again                | The rejected machine is excluded      |
| Reject, with no other machine available | `BLOCKED`, with a reason              |
| Not approved by `plannedStart`          | `EXPIRED`, job `CANCELLED`, slot free |
| Approve at the moment it expires        | Exactly one outcome wins              |
| `plannedStart` arrives before approval  | The dispatcher does not start the job |

## Events

| Scenario                                 | Expected result                   |
| ---------------------------------------- | --------------------------------- |
| Same event sent twice                    | The second has no effect          |
| Older event arrives after a newer one    | State is not overwritten          |
| Event retried after heartbeats continued | It is still processed             |
| Simulator restarts                       | Its new events are still accepted |

## Commands

| Scenario                                  | Expected result                      |
| ----------------------------------------- | ------------------------------------ |
| Heartbeat response lost                   | Command resent, job started once     |
| Machine fails with a command pending      | Command `CANCELLED`, never delivered |
| Machine still busy at next `plannedStart` | Start waits until it is `IDLE`       |

## Failure

| Scenario                                | Expected result                              |
| --------------------------------------- | -------------------------------------------- |
| Machine fails mid-job                   | Job `RELEASED`, reroute proposed, slot held  |
| Same failure event sent twice           | Nothing changes the second time              |
| Machine with several future jobs fails  | All released, earliest deadline routed first |
| Fails while a proposal on it is pending | `SUPERSEDED`, its hold cancelled             |
| Crash midway through failure handling   | Full rollback, and the retry works           |
| No alternative machine                  | `BLOCKED` with a reason, job kept            |
| Reroute approved                        | Work moves with no overlap, restarts in full |
| Reroute rejected                        | Hold cancelled, order `DRAFT`                |

## Offline and recovery

| Scenario                           | Expected result                                    |
| ---------------------------------- | -------------------------------------------------- |
| Heartbeats stop                    | `OFFLINE`, same reroute as a failure               |
| Machine was actually still running | Late completion changes nothing, `CANCEL_JOB` sent |
| Machine reset                      | Eligible again, `BLOCKED` orders retried           |
| Retry still finds no machine       | Order stays `BLOCKED`, no new decision stored      |

## Site down

| Scenario                                  | Expected result                       |
| ----------------------------------------- | ------------------------------------- |
| Site set down while unreachable           | Work rerouted without `FAIL` arriving |
| Heartbeat from a machine at a down site   | It stays unavailable                  |
| Failure arrives after a site already fell | Nothing is released twice             |
