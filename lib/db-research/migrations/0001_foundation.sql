-- Foundation: schemas and the registry of Databento source files.
-- Bars, metrics, contracts, runs, and ML tables arrive in later migrations.
CREATE SCHEMA market;
CREATE SCHEMA research;
CREATE SCHEMA ml;

COMMENT ON SCHEMA market IS 'Market data derived from Databento DBN files: catalog, contracts, bars, metrics';
COMMENT ON SCHEMA research IS 'Backtest runs, trades, and feature-set versions';
COMMENT ON SCHEMA ml IS 'ML rows (one would-be trade per signal), models, and predictions';

-- One row per downloaded Databento file. DBN files stay the permanent tick archive;
-- derived rows reference the files they came from.
CREATE TABLE market.source_file (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dataset text NOT NULL,
    schema_name text NOT NULL,
    job_id text NOT NULL,
    file_name text NOT NULL,
    utc_date date NOT NULL,
    parents text[] NOT NULL CHECK (cardinality(parents) > 0),
    byte_count bigint NOT NULL CHECK (byte_count >= 0),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    condition text NOT NULL CHECK (condition IN ('available', 'degraded', 'pending', 'missing')),
    registered_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (job_id, file_name)
);
CREATE INDEX source_file_date ON market.source_file (dataset, schema_name, utc_date);
