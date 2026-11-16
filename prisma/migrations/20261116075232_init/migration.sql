-- CreateEnum
CREATE TYPE "public"."RestaurantSource" AS ENUM ('manual', 'spice_sync');

-- CreateEnum
CREATE TYPE "public"."MappingStatus" AS ENUM ('proposed', 'verified', 'rejected', 'stale');

-- CreateEnum
CREATE TYPE "public"."MappingSource" AS ENUM ('agent', 'human');

-- CreateEnum
CREATE TYPE "public"."RecaptchaMode" AS ENUM ('off', 'invisible', 'step_up', 'always');

-- CreateEnum
CREATE TYPE "public"."ActiveStatus" AS ENUM ('active', 'revoked');

-- CreateEnum
CREATE TYPE "public"."ReservationStatus" AS ENUM ('pending', 'confirmed', 'failed');

-- CreateEnum
CREATE TYPE "public"."DeliveryStatus" AS ENUM ('pending', 'delivered', 'dead');

-- CreateTable
CREATE TABLE "public"."restaurants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "phone" TEXT,
    "website" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "timezone" TEXT NOT NULL,
    "max_party_size" INTEGER NOT NULL DEFAULT 20,
    "source" "public"."RestaurantSource" NOT NULL DEFAULT 'manual',
    "spice_ref" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."venue_mappings" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "venue_id" TEXT NOT NULL,
    "venue_url" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "status" "public"."MappingStatus" NOT NULL DEFAULT 'proposed',
    "evidence" JSONB,
    "source" "public"."MappingSource" NOT NULL DEFAULT 'human',
    "bookable" BOOLEAN NOT NULL DEFAULT true,
    "recaptcha_mode" "public"."RecaptchaMode",
    "flags_checked_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "venue_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."api_clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_email" TEXT,
    "tenant" TEXT,
    "status" "public"."ActiveStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."api_keys" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scopes" TEXT[],
    "status" "public"."ActiveStatus" NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."reservations" (
    "id" TEXT NOT NULL,
    "api_client_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "venue_id" TEXT NOT NULL,
    "datetime" TIMESTAMP(3) NOT NULL,
    "local_date" TEXT NOT NULL,
    "local_time" TEXT NOT NULL,
    "party_size" INTEGER NOT NULL,
    "notes" TEXT,
    "status" "public"."ReservationStatus" NOT NULL DEFAULT 'pending',
    "platform_confirmation_code" TEXT,
    "booking_attempts" INTEGER NOT NULL DEFAULT 0,
    "in_flight" BOOLEAN NOT NULL DEFAULT false,
    "submitted" BOOLEAN NOT NULL DEFAULT false,
    "script_id" TEXT,
    "error_code" TEXT,
    "error_detail" TEXT,
    "request_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."webhook_deliveries" (
    "event_id" TEXT NOT NULL,
    "reservation_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "public"."DeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "replays" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_http_status" INTEGER,
    "last_error" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "api_key_prefix" TEXT,
    "user_ref" TEXT,
    "token_issuer" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "outcome" TEXT NOT NULL,
    "request_id" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "changes" JSONB,
    "metadata" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."error_logs" (
    "id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "error_code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "fingerprint" TEXT NOT NULL,
    "request_id" TEXT,
    "api_client_id" TEXT,
    "reservation_id" TEXT,
    "context" JSONB,

    CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "restaurants_spice_ref_key" ON "public"."restaurants"("spice_ref");

-- CreateIndex
CREATE UNIQUE INDEX "venue_mappings_restaurant_id_platform_key" ON "public"."venue_mappings"("restaurant_id", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "public"."api_keys"("prefix");

-- CreateIndex
CREATE INDEX "reservations_status_created_at_idx" ON "public"."reservations"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_api_client_id_idempotency_key_key" ON "public"."reservations"("api_client_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_attempt_at_idx" ON "public"."webhook_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_reservation_id_idx" ON "public"."webhook_deliveries"("reservation_id");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "public"."audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_occurred_at_idx" ON "public"."audit_logs"("actor_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_occurred_at_idx" ON "public"."audit_logs"("action", "occurred_at");

-- CreateIndex
CREATE INDEX "error_logs_fingerprint_occurred_at_idx" ON "public"."error_logs"("fingerprint", "occurred_at");

-- CreateIndex
CREATE INDEX "error_logs_error_code_occurred_at_idx" ON "public"."error_logs"("error_code", "occurred_at");

-- CreateIndex
CREATE INDEX "error_logs_request_id_idx" ON "public"."error_logs"("request_id");

-- AddForeignKey
ALTER TABLE "public"."venue_mappings" ADD CONSTRAINT "venue_mappings_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."api_keys" ADD CONSTRAINT "api_keys_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."api_clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- audit_logs is append-only (DESIGN.md §8.1): reject UPDATE and DELETE for every role.
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();
