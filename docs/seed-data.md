# Seed data

The data loaded by `npm run db:seed`, for local development and demos. The source is [`apps/backend/prisma/seed-data.ts`](../apps/backend/prisma/seed-data.ts); keep this page in sync with it.

Seeding **replaces all data**, including orders created through the API. It runs in one transaction and refuses to run when `NODE_ENV=production`.

## Sites

| Id    | Name    | Country |
| ----- | ------- | ------- |
| `HAM` | Hamburg | DE      |
| `LON` | London  | GB      |
| `KYI` | Kyiv    | UA      |

## Machines

Each capability has its own cycle time: the minutes one part takes. For example, 10 parts of 5-axis work on `HAM-MILL5-1` take 10 × 12 = 120 minutes.

| Machine          | Site    | Capability: minutes per part           |
| ---------------- | ------- | -------------------------------------- |
| `HAM-MILL3-1`    | Hamburg | 3-axis milling: 8                      |
| `HAM-MILL5-1`    | Hamburg | 5-axis milling: 12; 3-axis milling: 10 |
| `HAM-MILL5-2`    | Hamburg | 5-axis milling: 12; 3-axis milling: 10 |
| `HAM-LATHE-1`    | Hamburg | Turning: 5                             |
| `LON-MILL5-1`    | London  | 5-axis milling: 11; 3-axis milling: 9  |
| `LON-TURNMILL-1` | London  | Turning: 7; 3-axis milling: 11         |
| `LON-LATHE-1`    | London  | Turning: 6                             |
| `KYI-MILL3-1`    | Kyiv    | 3-axis milling: 7                      |
| `KYI-MILL5-1`    | Kyiv    | 5-axis milling: 13; 3-axis milling: 10 |
| `KYI-CMM-1`      | Kyiv    | Inspection: 4                          |

- `HAM-MILL5-2` is an identical twin of `HAM-MILL5-1`, so the tie-break rule and the parallel double-booking test (W2-06) have two equal machines to choose between.
- 5-axis mills can also do 3-axis work, as in real shops, so routing has real choices.
- `LON-TURNMILL-1` is the only machine that does both turning and milling.

## Shipping times

The days needed to ship finished parts from a site to the customer, in the order's destination country. Routing adds this to production time, so an order counts as on time only if the parts **arrive** by its deadline. The same order can therefore fit at one site and miss its deadline at another.

| From \ To | DE  | GB  | FR  | UA  | US  |
| --------- | --- | --- | --- | --- | --- |
| HAM       | 1   | 3   | 2   | 4   | 7   |
| LON       | 3   | 1   | 2   | 5   | 6   |
| KYI       | 4   | 5   | 4   | 1   | 9   |

Orders can only use these five destinations. `POST /api/orders` rejects any other with a 400.

## Orders

All orders start as `DRAFT`. Deadlines are relative to when the seed runs, so they never fall in the past.

| Part               | Quantity | Capabilities               | Deadline in | Destination |
| ------------------ | -------- | -------------------------- | ----------- | ----------- |
| Bracket housing    | 40       | 5-axis milling             | 10 days     | DE          |
| Mounting plate     | 120      | 3-axis milling             | 7 days      | GB          |
| Drive shaft        | 60       | Turning                    | 5 days      | FR          |
| Flange adapter     | 25       | Turning, 3-axis milling    | 14 days     | GB          |
| Impeller           | 10       | 5-axis milling             | 21 days     | US          |
| Sensor mount       | 200      | 3-axis milling             | 12 days     | UA          |
| Gearbox cover      | 80       | Inspection                 | 6 days      | UA          |
| Bushing            | 150      | Turning                    | 9 days      | DE          |
| Turbine blade      | 15       | 5-axis milling             | 4 days      | GB          |
| Valve body         | 30       | Turning, 3-axis milling    | 20 days     | DE          |
| Heat sink          | 90       | 3-axis milling             | 3 days      | FR          |
| Pump housing       | 35       | 5-axis milling             | 30 days     | UA          |
| Spacer ring        | 5        | Turning                    | 2 days      | GB          |
| Precision manifold | 20       | 5-axis milling, inspection | 25 days     | DE          |
| Express pin        | 50       | Turning                    | 3 days      | US          |

**Orders that must become BLOCKED** once routing exists:

- **Precision manifold:** no single machine does both 5-axis milling and inspection.
- **Express pin:** the fastest shipping to the US is 6 days, from London, but the deadline is 3 days away.

**Orders worth watching:**

- **Flange adapter** and **Valve body** need turning and 3-axis milling together, so only `LON-TURNMILL-1` can make them. Their cycle time depends on how multi-capability orders are calculated, which is still open (see [design-decisions.md](design-decisions.md)).
- **Spacer ring** has a tight deadline, but it fits on London's lathe with 1 day of shipping to GB.
