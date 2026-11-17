-- PR F: outcome labels of swing candidates (strategy_core.stage_pivot_label; the labeler in
-- strategy_core.pivot_labels; parameters frozen in docs/project/pivot-label-spec.md). Every other
-- table is unchanged; ingest adds these without rewriting them.
--
-- A label variant (market.variant) is one swing scale at one stage q with its barriers and
-- horizon: the label ID. Each is a stage of its own, writing rows keyed by variant_id into the
-- table of its scale's resolution. Rows are sparse: one per candidate, at its decision row (the
-- first row close at which the scale's running extreme showed progress of at least q), and one
-- per confirmed high or low that never was a candidate at a close (outcome 0, at its
-- confirmation row). seq orders a variant's rows within one decision row.
--
-- Labels look into the future. No column is a feature (market.column_registry.role is never
-- 'feature' here), no stage reads these tables, and they are never joined into feature tables.
-- available_ns says when both outcomes were known, for purging training splits. ext_px is a raw
-- price: context. Monthly partitions on end_ns are created by the ingest command.

-- Fast scales: slot_ordinal counts scheduled-open seconds; the horizon is 300 rows.
CREATE TABLE market.pivot_label_1s (
    contract_id bigint NOT NULL,
    slot_ordinal bigint NOT NULL,
    end_ns bigint NOT NULL,
    available_ns bigint NOT NULL,
    ext_ordinal bigint NOT NULL,
    ext_px bigint NOT NULL,
    outcome_ordinal bigint NOT NULL,
    outcome_at_ns bigint,
    survival_ordinal bigint,
    break_at_ns bigint,
    theta_bps double precision,
    progress double precision,
    displacement double precision,
    segment integer NOT NULL,
    seq integer NOT NULL,
    variant_id smallint NOT NULL,
    kind smallint NOT NULL CHECK (kind IN (1, 2)),
    outcome smallint NOT NULL CHECK (outcome BETWEEN 0 AND 5),
    survival smallint CHECK (survival IN (1, 2, 4, 5)),
    prov smallint,
    PRIMARY KEY (contract_id, variant_id, slot_ordinal, seq, end_ns)
) PARTITION BY RANGE (end_ns);
CREATE INDEX pivot_label_1s_end ON market.pivot_label_1s USING brin (end_ns);
COMMENT ON TABLE market.pivot_label_1s IS
    'Outcome labels of fast (1m@1s ATR) swing candidates: future-looking, never a model input';
COMMENT ON COLUMN market.pivot_label_1s.variant_id IS
    'The label ID (scale, stage, barriers, horizon): market.variant.id';

-- Slow scales: slot_ordinal counts scheduled-open minutes; the horizon is 240 rows.
CREATE TABLE market.pivot_label_1m (
    contract_id bigint NOT NULL,
    slot_ordinal bigint NOT NULL,
    end_ns bigint NOT NULL,
    available_ns bigint NOT NULL,
    ext_ordinal bigint NOT NULL,
    ext_px bigint NOT NULL,
    outcome_ordinal bigint NOT NULL,
    outcome_at_ns bigint,
    survival_ordinal bigint,
    break_at_ns bigint,
    theta_bps double precision,
    progress double precision,
    displacement double precision,
    segment integer NOT NULL,
    seq integer NOT NULL,
    variant_id smallint NOT NULL,
    kind smallint NOT NULL CHECK (kind IN (1, 2)),
    outcome smallint NOT NULL CHECK (outcome BETWEEN 0 AND 5),
    survival smallint CHECK (survival IN (1, 2, 4, 5)),
    prov smallint,
    PRIMARY KEY (contract_id, variant_id, slot_ordinal, seq, end_ns)
) PARTITION BY RANGE (end_ns);
CREATE INDEX pivot_label_1m_end ON market.pivot_label_1m USING brin (end_ns);
COMMENT ON TABLE market.pivot_label_1m IS
    'Outcome labels of slow (1h@1m ATR) swing candidates: future-looking, never a model input';
COMMENT ON COLUMN market.pivot_label_1m.variant_id IS
    'The label ID (scale, stage, barriers, horizon): market.variant.id';

-- The continuous series of each product: every session's labels from its front contract, for
-- every label variant that is not retired (filter on variant_id).
CREATE VIEW market.continuous_pivot_label_1s AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, l.*
FROM market.front_session f
JOIN market.pivot_label_1s l
  ON l.contract_id = f.contract_id
 AND l.slot_ordinal BETWEEN f.first_ordinal AND f.last_ordinal
 AND l.end_ns > f.open_ns AND l.end_ns <= f.close_ns
JOIN market.variant v ON v.id = l.variant_id AND v.retired_at IS NULL;
COMMENT ON VIEW market.continuous_pivot_label_1s IS
    'Labels of each product session from its front contract (join market.variant for the label ID)';

CREATE VIEW market.continuous_pivot_label_1m AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, l.*
FROM market.front_session f
JOIN market.pivot_label_1m l
  ON l.contract_id = f.contract_id
 AND l.slot_ordinal BETWEEN (f.first_ordinal + 59) / 60 AND f.last_ordinal / 60
 AND l.end_ns > f.open_ns AND l.end_ns <= f.close_ns
JOIN market.variant v ON v.id = l.variant_id AND v.retired_at IS NULL;
COMMENT ON VIEW market.continuous_pivot_label_1m IS
    'Labels of each product session from its front contract (join market.variant for the label ID)';
