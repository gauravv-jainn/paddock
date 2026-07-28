-- users.email and users.handle are CITEXT (docs/04 §2), so the extension has
-- to exist before the identity tables are created in the next migration.
CREATE EXTENSION IF NOT EXISTS citext;
