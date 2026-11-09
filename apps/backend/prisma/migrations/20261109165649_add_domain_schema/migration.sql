-- CreateEnum
CREATE TYPE "site_status" AS ENUM ('UP', 'DOWN');

-- CreateEnum
CREATE TYPE "machine_status" AS ENUM ('IDLE', 'RUNNING', 'ERROR', 'OFFLINE');

-- CreateEnum
CREATE TYPE "capability" AS ENUM ('MILLING_3_AXIS', 'MILLING_5_AXIS', 'TURNING', 'INSPECTION');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('DRAFT', 'ROUTED', 'APPROVED', 'IN_PRODUCTION', 'COMPLETE', 'BLOCKED', 'REROUTE_PENDING');

-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('PLANNED', 'RUNNING', 'COMPLETE', 'RELEASED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "routing_decision_kind" AS ENUM ('INITIAL', 'REROUTE');

-- CreateEnum
CREATE TYPE "routing_decision_status" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'EXPIRED', 'SUPERSEDED', 'NO_ELIGIBLE_MACHINE');

-- CreateEnum
CREATE TYPE "candidate_rejection_reason" AS ENUM ('MISSING_CAPABILITY', 'MACHINE_UNAVAILABLE', 'SITE_DOWN', 'MISSES_DEADLINE', 'REJECTED_BY_OPERATOR');

-- CreateEnum
CREATE TYPE "machine_event_type" AS ENUM ('JOB_STARTED', 'JOB_COMPLETED', 'MACHINE_FAILURE');

-- CreateEnum
CREATE TYPE "command_type" AS ENUM ('START_JOB', 'FAIL', 'RESET', 'CANCEL_JOB');

-- CreateEnum
CREATE TYPE "command_status" AS ENUM ('PENDING', 'DELIVERED', 'ACKED', 'CANCELLED');

-- CreateTable
CREATE TABLE "site" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "status" "site_status" NOT NULL DEFAULT 'UP',

    CONSTRAINT "site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "machine_status" NOT NULL DEFAULT 'IDLE',
    "last_heartbeat_at" TIMESTAMPTZ(3),
    "last_seq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "machine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_capability" (
    "machine_id" TEXT NOT NULL,
    "capability" "capability" NOT NULL,
    "cycle_minutes_per_part" DECIMAL(8,2) NOT NULL,

    CONSTRAINT "machine_capability_pkey" PRIMARY KEY ("machine_id","capability")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "part_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "required_capabilities" "capability"[],
    "deadline" TIMESTAMPTZ(3) NOT NULL,
    "destination" TEXT NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'DRAFT',
    "blocked_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job" (
    "id" TEXT NOT NULL,
    "routing_decision_id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "status" "job_status" NOT NULL DEFAULT 'PLANNED',
    "planned_start" TIMESTAMPTZ(3) NOT NULL,
    "planned_end" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_decision" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "chosen_machine_id" TEXT,
    "explanation" TEXT NOT NULL,
    "kind" "routing_decision_kind" NOT NULL,
    "status" "routing_decision_status" NOT NULL DEFAULT 'PROPOSED',
    "supersedes_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "routing_decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_candidate" (
    "routing_decision_id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "rank" INTEGER,
    "rejection_reason" "candidate_rejection_reason",
    "earliest_start" TIMESTAMPTZ(3),
    "finish_at" TIMESTAMPTZ(3),
    "slack_minutes" DECIMAL(12,2),

    CONSTRAINT "routing_candidate_pkey" PRIMARY KEY ("routing_decision_id","machine_id")
);

-- CreateTable
CREATE TABLE "machine_event" (
    "id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "seq" BIGINT NOT NULL,
    "type" "machine_event_type" NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "machine_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "command" (
    "id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "type" "command_type" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "command_status" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "command_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_lead_time" (
    "site_id" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "days" INTEGER NOT NULL,

    CONSTRAINT "shipping_lead_time_pkey" PRIMARY KEY ("site_id","destination")
);

-- CreateIndex
CREATE INDEX "machine_site_id_idx" ON "machine"("site_id");

-- CreateIndex
CREATE INDEX "job_routing_decision_id_idx" ON "job"("routing_decision_id");

-- CreateIndex
CREATE INDEX "job_machine_id_idx" ON "job"("machine_id");

-- CreateIndex
CREATE INDEX "routing_decision_order_id_idx" ON "routing_decision"("order_id");

-- CreateIndex
CREATE INDEX "routing_decision_chosen_machine_id_idx" ON "routing_decision"("chosen_machine_id");

-- CreateIndex
CREATE INDEX "routing_decision_supersedes_id_idx" ON "routing_decision"("supersedes_id");

-- CreateIndex
CREATE INDEX "routing_candidate_machine_id_idx" ON "routing_candidate"("machine_id");

-- CreateIndex
CREATE UNIQUE INDEX "machine_event_machine_id_event_id_key" ON "machine_event"("machine_id", "event_id");

-- CreateIndex
CREATE INDEX "command_machine_id_status_idx" ON "command"("machine_id", "status");

-- AddForeignKey
ALTER TABLE "machine" ADD CONSTRAINT "machine_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_capability" ADD CONSTRAINT "machine_capability_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_routing_decision_id_fkey" FOREIGN KEY ("routing_decision_id") REFERENCES "routing_decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_decision" ADD CONSTRAINT "routing_decision_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_decision" ADD CONSTRAINT "routing_decision_chosen_machine_id_fkey" FOREIGN KEY ("chosen_machine_id") REFERENCES "machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_decision" ADD CONSTRAINT "routing_decision_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "routing_decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_candidate" ADD CONSTRAINT "routing_candidate_routing_decision_id_fkey" FOREIGN KEY ("routing_decision_id") REFERENCES "routing_decision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_candidate" ADD CONSTRAINT "routing_candidate_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_event" ADD CONSTRAINT "machine_event_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command" ADD CONSTRAINT "command_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_lead_time" ADD CONSTRAINT "shipping_lead_time_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
