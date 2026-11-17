-- Rule 1: a machine runs one job at a time, enforced by the database and not only by
-- application code. Written by hand, because Prisma cannot describe these constraints.

-- No two active jobs on the same machine may overlap in time.
-- Needs the btree_gist extension (enabled in the init migration) to combine `=` on the
-- machine with `&&` (overlaps) on the time range in one index.
-- tstzrange(start, end) is half-open, [start, end), so back-to-back jobs do not collide.
-- Only PLANNED and RUNNING jobs count: released, cancelled and complete jobs stay as
-- history without holding the slot.
ALTER TABLE "job" ADD CONSTRAINT "job_no_overlap"
  EXCLUDE USING gist (
    "machine_id" WITH =,
    tstzrange("planned_start", "planned_end") WITH &&
  )
  WHERE ("status" IN ('PLANNED', 'RUNNING'));

-- A job must take some time. A zero-length range overlaps nothing, so it would slip past
-- the constraint above.
ALTER TABLE "job" ADD CONSTRAINT "job_planned_end_after_start"
  CHECK ("planned_end" > "planned_start");
