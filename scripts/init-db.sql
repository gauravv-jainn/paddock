-- Runs once, on an empty data volume, via docker-entrypoint-initdb.d.
--
-- paperhorse_dev is created by POSTGRES_DB; this adds the test database and
-- the citext extension both of them need (migration 0002 also creates it, so
-- this is belt and braces for a database restored some other way).

CREATE DATABASE paperhorse_test OWNER paperhorse;

\connect paperhorse_dev
CREATE EXTENSION IF NOT EXISTS citext;

\connect paperhorse_test
CREATE EXTENSION IF NOT EXISTS citext;
