-- The webhook now carries every final reservation status, not only failures.
-- Rows written before this change were all failure events, so backfill them as such.
ALTER TABLE "public"."webhook_deliveries" ADD COLUMN "event_type" TEXT NOT NULL DEFAULT 'reservation.failed';
ALTER TABLE "public"."webhook_deliveries" ALTER COLUMN "event_type" DROP DEFAULT;
