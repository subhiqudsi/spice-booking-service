-- Reservations are listed per user (GET /v1/reservations). Rows made before this change have no
-- known user; they get an empty user_ref and so never appear in a user's list.
ALTER TABLE "public"."reservations" ADD COLUMN "user_ref" TEXT NOT NULL DEFAULT '';
ALTER TABLE "public"."reservations" ALTER COLUMN "user_ref" DROP DEFAULT;

CREATE INDEX "reservations_api_client_id_user_ref_datetime_idx"
  ON "public"."reservations"("api_client_id", "user_ref", "datetime");
