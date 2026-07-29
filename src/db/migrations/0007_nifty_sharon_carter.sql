-- Decision log D1, D3 and D6 (docs/08-decision-log.md).
--
-- ledger_entries is deliberately untouched. D1 changes what amount_minor
-- *means* — GBP pence rather than USD cents — not its type or its contents.
-- The column stays BIGINT and the append-only trigger is not disturbed.

-- D6: tracks.country_code is an ISO-3166-1 alpha-2 country. horses.country_code
-- was a three-letter breeding suffix (IRE, USA, GER). Same name, different
-- meaning, adjacent tables.
ALTER TABLE "horses" RENAME COLUMN "country_code" TO "breeding_suffix";--> statement-breakpoint
ALTER TABLE "horses" DROP CONSTRAINT "horses_name_country_code_foaled_year_key";--> statement-breakpoint

-- D3: is_handicap is a settlement input. A default silently turns "the feed did
-- not say" into "not a handicap", which pays a different number of places on
-- some field sizes and reports nothing.
ALTER TABLE "races" ALTER COLUMN "is_handicap" DROP DEFAULT;--> statement-breakpoint

-- D1: the accounting currency is GBP.
ALTER TABLE "wallets" ALTER COLUMN "currency" SET DEFAULT 'GBP';--> statement-breakpoint

-- D1: and the rows written before the decision. These are development wallets
-- only — no user money has ever existed in this system.
UPDATE "wallets" SET "currency" = 'GBP' WHERE "currency" = 'USD';--> statement-breakpoint

ALTER TABLE "horses" ADD CONSTRAINT "horses_name_breeding_suffix_foaled_year_key" UNIQUE NULLS NOT DISTINCT("name","breeding_suffix","foaled_year");
