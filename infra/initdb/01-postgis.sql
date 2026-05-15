-- Enable PostGIS up-front so first-run migrations can reference geography types.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
