-- AlterTable
ALTER TABLE "command" ALTER COLUMN "created_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "machine_event" ALTER COLUMN "received_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "created_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "routing_decision" ALTER COLUMN "created_at" DROP DEFAULT;
