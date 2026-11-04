-- Stages (docs/project/feature-pipeline.md): every stored table is a stage with its own version
-- and its own per-session checkpoint, so adding or changing one stage never invalidates the
-- rows of a stage that does not depend on it.

-- Builder identities are per stage. "source" versions the market source (files, calendar,
-- trade-assignment timing); every stage's identity includes the identities of its inputs.
ALTER TABLE market.builder ADD COLUMN stage text;
COMMENT ON COLUMN market.builder.stage IS
    'Stage this identity versions ("source" for the market source); NULL before stages';

-- market.ingest_slice stays the record of each stored contract session: the source files and
-- their quality report, the row bounds the continuous series reads, and the source builder.
-- Checkpoints moved to market.stage_slice, one per stage.
ALTER TABLE market.ingest_slice ALTER COLUMN state DROP NOT NULL;
COMMENT ON TABLE market.ingest_slice IS
    'One stored contract session: source files, quality report, row bounds, source builder';
COMMENT ON COLUMN market.ingest_slice.builder_id IS 'Builder of the market source (stage "source")';
COMMENT ON COLUMN market.ingest_slice.state IS
    'Combined checkpoint written before stages; NULL since checkpoints are per stage';

-- One row per stage, variant, and stored contract session: the stage builder that wrote the
-- session's rows, the stage checkpoint after it, and whether its values had settled.
CREATE TABLE market.stage_slice (
    stage text NOT NULL,
    variant_id bigint NOT NULL DEFAULT 0,  -- 0: a stage without variants
    contract_id bigint NOT NULL,
    trade_date date NOT NULL,
    builder_id bigint NOT NULL REFERENCES market.builder (id),
    run_id bigint NOT NULL REFERENCES market.ingest_run (id),
    state bytea NOT NULL,
    warm boolean NOT NULL,
    build_seconds real NOT NULL,
    ingested_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (stage, variant_id, contract_id, trade_date),
    FOREIGN KEY (contract_id, trade_date) REFERENCES market.ingest_slice ON DELETE CASCADE
);
CREATE INDEX stage_slice_session ON market.stage_slice (contract_id, trade_date);
CREATE INDEX stage_slice_builder ON market.stage_slice (builder_id);
COMMENT ON TABLE market.stage_slice IS
    'Per stage, variant, and contract session: builder, checkpoint, and warm flag';
COMMENT ON COLUMN market.stage_slice.warm IS
    'The contract had run at least the stage''s derived warm-up before this session';

-- Parameter grids of a stage (for example pivot scales) are variants: rows, not columns.
CREATE TABLE market.variant (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    stage text NOT NULL,
    name text NOT NULL,
    params jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (stage, name)
);
COMMENT ON TABLE market.variant IS
    'Variants of a stage over a parameter grid; their rows are keyed by variant_id';

-- Every stored column with its role, from the stages' Python registries (store.apply_registry).
CREATE TABLE market.column_registry (
    stage text NOT NULL,
    name text NOT NULL,
    role text NOT NULL CHECK (role IN ('feature', 'context', 'key')),
    unit text,
    sql_type text NOT NULL,
    description text NOT NULL,
    status text NOT NULL CHECK (status IN ('active', 'deprecated')),
    introduced_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (stage, name),
    CHECK ((role = 'feature') = (unit IS NOT NULL))
);
COMMENT ON TABLE market.column_registry IS
    'Stored columns: feature (normalized model input with a unit), context (source units, never '
    'a model input), or key';

-- Price-path statistics of each second, from its trades in release order (metrics.py): what the
-- high and low cannot show. They merge exactly into minutes and windows with the high and low.
ALTER TABLE market.bar_1s ADD COLUMN drawdown bigint;
ALTER TABLE market.bar_1s ADD COLUMN drawup bigint;
ALTER TABLE market.bar_1s ADD COLUMN extreme_order integer;

-- The continuous view selects bar_1s.*, fixed when it was created: recreate it.
DROP VIEW market.continuous_bar_1s;
CREATE VIEW market.continuous_bar_1s AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, b.*
FROM market.front_session f
JOIN market.bar_1s b
  ON b.contract_id = f.contract_id
 AND b.slot_ordinal BETWEEN f.first_ordinal AND f.last_ordinal
 AND b.end_ns > f.open_ns AND b.end_ns <= f.close_ns;
COMMENT ON VIEW market.continuous_bar_1s IS
    'One-second rows of each product session from its front contract: one series per product';
