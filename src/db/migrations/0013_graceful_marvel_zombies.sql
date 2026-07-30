CREATE TABLE "provider_payloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" text NOT NULL,
	"kind" text NOT NULL,
	"entity_ref" text NOT NULL,
	"body" jsonb NOT NULL,
	"body_sha256" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_payloads_provider_id_kind_entity_ref_body_sha256_key" UNIQUE("provider_id","kind","entity_ref","body_sha256"),
	CONSTRAINT "provider_payloads_kind_check" CHECK ("provider_payloads"."kind" in ('racecard','odds','result'))
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bet_id" uuid NOT NULL,
	"race_id" uuid NOT NULL,
	"result_version" integer NOT NULL,
	"outcome" text NOT NULL,
	"return_minor" bigint NOT NULL,
	"calculation" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"is_reversal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_bet_id_result_version_is_reversal_key" UNIQUE("bet_id","result_version","is_reversal"),
	CONSTRAINT "settlements_outcome_check" CHECK ("settlements"."outcome" in ('WON','LOST','VOID','PARTIAL','NEEDS_REVIEW')),
	CONSTRAINT "settlements_return_non_negative" CHECK ("settlements"."return_minor" >= 0)
);
--> statement-breakpoint
CREATE INDEX "settlements_race_id_idx" ON "settlements" USING btree ("race_id");--> statement-breakpoint
CREATE INDEX "settlements_needs_review_idx" ON "settlements" USING btree ("created_at") WHERE outcome = 'NEEDS_REVIEW';