-- docs/04 §3: wallets.user_id REFERENCES users(id) ON DELETE CASCADE.
--
-- The wallet tables are created in migration 0000 and users only exists from
-- 0003, so this constraint could not be declared with the column. It is kept
-- out of src/modules/wallet/schema.ts for the same reason: the wallet module
-- must not import the identity module's schema.
--
-- Note that ledger_entries.wallet_id has no ON DELETE action, so the cascade
-- stops there: a user with any ledger history cannot be hard-deleted. That is
-- the intended behaviour — users.status = 'deleted' is the soft-delete path.
ALTER TABLE wallets
  ADD CONSTRAINT wallets_user_id_users_id_fk
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
