CREATE TABLE "ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"txn_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"entry_type" text NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_entry_type_check" CHECK ("ledger_entries"."entry_type" in ('OPENING_BALANCE','STAKE','RETURN','REFUND','REVERSAL','ADJUSTMENT','BANKROLL_RESET')),
	CONSTRAINT "amount_nonzero" CHECK ("ledger_entries"."amount_minor" <> 0)
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_kind_check" CHECK ("wallets"."kind" in ('user','house','void_pool')),
	CONSTRAINT "user_wallet_requires_user" CHECK (("wallets"."kind" = 'user') = ("wallets"."user_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entries_wallet_id_created_at_idx" ON "ledger_entries" USING btree ("wallet_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ledger_entries_txn_id_idx" ON "ledger_entries" USING btree ("txn_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_ref_type_ref_id_idx" ON "ledger_entries" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_user_id_key" ON "wallets" USING btree ("user_id") WHERE kind = 'user';