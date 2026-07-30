-- docs/04 §7: settlements.bet_id REFERENCES bets(id), race_id REFERENCES races(id).
--
-- Hand-written for the same reason as 0004: the referenced tables belong to
-- other modules, so the settlement module's schema file cannot declare the
-- reference without importing another module's schema — which
-- .claude/rules/modules.md forbids. The constraint still belongs in the
-- database; only its declaration site moves.
--
-- ON DELETE NO ACTION on both. A settlement is the record of why money moved
-- and must outlive any attempt to tidy up a bet or a race; cascading here would
-- delete the evidence behind a ledger entry that cannot itself be deleted.

ALTER TABLE settlements
  ADD CONSTRAINT settlements_bet_id_bets_id_fk
  FOREIGN KEY (bet_id) REFERENCES bets(id);
--> statement-breakpoint
ALTER TABLE settlements
  ADD CONSTRAINT settlements_race_id_races_id_fk
  FOREIGN KEY (race_id) REFERENCES races(id);
