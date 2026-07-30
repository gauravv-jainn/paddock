CREATE TABLE "bet_legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bet_id" uuid NOT NULL,
	"leg_index" smallint NOT NULL,
	"race_id" uuid NOT NULL,
	"runner_id" uuid NOT NULL,
	"finish_slot" smallint,
	"odds_taken" numeric(10, 3) NOT NULL,
	"odds_format" text DEFAULT 'decimal' NOT NULL,
	"outcome" text DEFAULT 'pending',
	CONSTRAINT "bet_legs_bet_id_leg_index_key" UNIQUE("bet_id","leg_index"),
	CONSTRAINT "bet_legs_outcome_check" CHECK ("bet_legs"."outcome" is null or "bet_legs"."outcome" in ('pending','won','placed','lost','void'))
);
--> statement-breakpoint
CREATE TABLE "bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"bet_type" text NOT NULL,
	"unit_stake_minor" bigint NOT NULL,
	"total_stake_minor" bigint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"return_minor" bigint DEFAULT 0 NOT NULL,
	"settled_version" integer,
	CONSTRAINT "bets_user_id_idempotency_key_key" UNIQUE("user_id","idempotency_key"),
	CONSTRAINT "bets_bet_type_check" CHECK ("bets"."bet_type" in ('WIN','PLACE','EACH_WAY','SHOW','EXACTA','QUINELLA','TRIFECTA','SUPERFECTA','DOUBLE','TREBLE','ACCUMULATOR')),
	CONSTRAINT "bets_status_check" CHECK ("bets"."status" in ('open','won','lost','void','partial','cancelled','needs_review')),
	CONSTRAINT "bets_unit_stake_positive" CHECK ("bets"."unit_stake_minor" > 0),
	CONSTRAINT "bets_total_stake_positive" CHECK ("bets"."total_stake_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "bet_legs" ADD CONSTRAINT "bet_legs_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bet_legs_race_id_pending_idx" ON "bet_legs" USING btree ("race_id") WHERE outcome = 'pending';--> statement-breakpoint
CREATE INDEX "bets_user_id_placed_at_idx" ON "bets" USING btree ("user_id","placed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bets_open_idx" ON "bets" USING btree ("status") WHERE status = 'open';