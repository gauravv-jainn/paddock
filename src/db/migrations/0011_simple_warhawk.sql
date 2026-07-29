-- Decision log D18 (docs/08-decision-log.md) — enhanced place terms are
-- opt-in per race.
--
-- Marquee meetings (Grand National, Cheltenham, Royal Ascot, the Ebor, the
-- Stewards' Cup, the Lincoln) commonly pay five to eight places. That is a
-- commercial promotion, not a rule change, so it must not be folded into the
-- standard place-terms table in docs/05 section 4.
--
--   both null          -> standard terms
--   both set           -> those terms apply verbatim, table not consulted
--   one set, one null  -> rejected below. Half an override is not a term.
--
-- enhanced_fraction is the DENOMINATOR: 4 means 1/4, 5 means 1/5. Integer, so
-- the place fraction never becomes a float on its way into the money path.
--
-- Consequence for tests/golden/: a historical race that ran under an enhanced
-- offer is EXCLUDED unless its real terms are recorded on the fixture. Settling
-- such a race at standard terms produces a wrong answer with a citation
-- attached, which is worse than no fixture.

ALTER TABLE "races" ADD COLUMN "enhanced_places" smallint;--> statement-breakpoint
ALTER TABLE "races" ADD COLUMN "enhanced_fraction" smallint;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_enhanced_terms_complete" CHECK (("races"."enhanced_places" is null) = ("races"."enhanced_fraction" is null));--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_enhanced_terms_sane" CHECK ("races"."enhanced_places" is null or ("races"."enhanced_places" > 0 and "races"."enhanced_fraction" > 0));