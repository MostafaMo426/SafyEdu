-- SafyEdu PostgreSQL initialization script
-- Runs automatically on first container start.
-- Enables required extensions in the safyedu_dev database.

\connect safyedu_dev;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
