-- PR D: swings (layer 2). Turning points of the price path at six scales, as new stages
-- (strategy_core.stage_pivot_1s, stage_pivot_1m; the detector in strategy_core.swings). Every
-- other table is unchanged; ingest adds these without rewriting them.
--
-- A scale is a variant (market.variant): its own stage, builder, checkpoint, and session records
-- (market.stage_slice.variant_id), writing rows keyed by variant_id into a shared table. Adding
-- a scale adds rows, never columns.

-- A variant's name never changes meaning: its parameters are fixed when it is registered, and a
-- changed scale gets a new name. A variant that no stage defines any more is retired, not
-- deleted: its rows stay until removed on purpose, and the continuous views leave them out.
ALTER TABLE market.variant ADD COLUMN retired_at timestamptz;
COMMENT ON COLUMN market.variant.retired_at IS
    'Set while no stage defines the variant; its rows are kept but left out of the continuous views';

-- Fast scales (thresholds in 1m@1s ATRs): one row per scheduled-open second, contract, and scale,
-- published after the second's trades. The open leg (direction, running extreme, progress toward
-- confirmation, size, flow), the latest confirmed high and low (distance, ages, change against
-- the previous one, class, run, first breach), trend, and the provisional lower high and higher
-- low. Distances are in the ATR frozen with the extreme they describe; ages count rows. All NULL
-- while the scale is idle (state 0). ext_px is a raw price: context, never a model input.
-- Monthly partitions on end_ns are created by the ingest command; columns are ordered by width.
CREATE TABLE market.pivot_1s (
    contract_id bigint NOT NULL,
    slot_ordinal bigint NOT NULL,
    end_ns bigint NOT NULL,
    ext_px bigint,
    progress double precision,
    theta_bps double precision,
    ext_dist_atr double precision,
    leg_atr double precision,
    leg_delta_ratio double precision,
    reversal_delta_ratio double precision,
    prev_leg_atr double precision,
    retrace double precision,
    cand_change_atr double precision,
    high_dist_atr double precision,
    high_change_atr double precision,
    high_run_ratio double precision,
    low_dist_atr double precision,
    low_change_atr double precision,
    low_run_ratio double precision,
    segment integer,
    ext_age_s integer,
    leg_age_s integer,
    trend_age_s integer,
    high_age_s integer,
    high_conf_age_s integer,
    break_up_age_s integer,
    low_age_s integer,
    low_conf_age_s integer,
    break_down_age_s integer,
    variant_id smallint NOT NULL,
    state smallint NOT NULL,
    dir smallint,
    trend smallint,
    high_class smallint,
    prov_lh smallint,
    low_class smallint,
    prov_hl smallint,
    phase smallint GENERATED ALWAYS AS ((slot_ordinal % 60)::smallint) VIRTUAL,
    PRIMARY KEY (contract_id, variant_id, slot_ordinal, end_ns)
) PARTITION BY RANGE (end_ns);
CREATE INDEX pivot_1s_end ON market.pivot_1s USING brin (end_ns);
COMMENT ON COLUMN market.pivot_1s.variant_id IS 'The scale: market.variant.id';

-- Slow scales (thresholds in 1h@1m ATRs): the same columns, one row per scheduled-open minute,
-- published after the minute's last second. Ages are in scheduled-open seconds (minute rows x 60).
CREATE TABLE market.pivot_1m (
    contract_id bigint NOT NULL,
    slot_ordinal bigint NOT NULL,
    end_ns bigint NOT NULL,
    ext_px bigint,
    progress double precision,
    theta_bps double precision,
    ext_dist_atr double precision,
    leg_atr double precision,
    leg_delta_ratio double precision,
    reversal_delta_ratio double precision,
    prev_leg_atr double precision,
    retrace double precision,
    cand_change_atr double precision,
    high_dist_atr double precision,
    high_change_atr double precision,
    high_run_ratio double precision,
    low_dist_atr double precision,
    low_change_atr double precision,
    low_run_ratio double precision,
    segment integer,
    ext_age_s integer,
    leg_age_s integer,
    trend_age_s integer,
    high_age_s integer,
    high_conf_age_s integer,
    break_up_age_s integer,
    low_age_s integer,
    low_conf_age_s integer,
    break_down_age_s integer,
    variant_id smallint NOT NULL,
    state smallint NOT NULL,
    dir smallint,
    trend smallint,
    high_class smallint,
    prov_lh smallint,
    low_class smallint,
    prov_hl smallint,
    phase smallint GENERATED ALWAYS AS ((slot_ordinal % 60)::smallint) VIRTUAL,
    PRIMARY KEY (contract_id, variant_id, slot_ordinal, end_ns)
) PARTITION BY RANGE (end_ns);
CREATE INDEX pivot_1m_end ON market.pivot_1m USING brin (end_ns);
COMMENT ON COLUMN market.pivot_1m.variant_id IS 'The scale: market.variant.id';

-- One row per event of a scale: a confirmed high or low, the first breach of the latest
-- confirmed high or low, and a reclaim of a breached level. slot_ordinal is the row (second for
-- fast scales, minute for slow) of the observation that produced it, and seq its order among the
-- scale's events in that row; with the builder that wrote it they identify the event, so a
-- rebuild by the same code reproduces the same keys and other code never reuses one for a
-- different pivot. A breach or reclaim refers to its pivot by (ref_ordinal, ref_seq) of the same
-- contract and scale. Events are immutable facts: a later break of a level is a new event.
-- level and atr are raw prices (context, never model inputs).
CREATE TABLE market.pivot_event (
    contract_id bigint NOT NULL,
    builder_id bigint NOT NULL,
    slot_ordinal bigint NOT NULL,
    end_ns bigint NOT NULL,
    at_ns bigint NOT NULL,
    available_ns bigint NOT NULL,
    ext_ordinal bigint,
    ext_at_ns bigint,
    ref_ordinal bigint,
    leg_volume bigint,
    leg_buy_volume bigint,
    leg_sell_volume bigint,
    level double precision,
    theta double precision,
    atr double precision,
    overshoot double precision,
    change_atr double precision,
    leg_atr double precision,
    depth_atr double precision,
    segment integer NOT NULL,
    leg_rows integer,
    age_s integer,
    seq integer NOT NULL,
    ref_seq integer,
    variant_id smallint NOT NULL,
    kind smallint NOT NULL CHECK (kind BETWEEN 1 AND 6),
    class smallint,
    run smallint,
    trend smallint,
    PRIMARY KEY (contract_id, variant_id, slot_ordinal, seq)
);
-- the continuous view reads a contract's events of a session: by contract and row end
CREATE INDEX pivot_event_end ON market.pivot_event (contract_id, end_ns);
COMMENT ON TABLE market.pivot_event IS
    'Confirmed highs and lows, breaches, and reclaims of every swing scale';
COMMENT ON COLUMN market.pivot_event.variant_id IS 'The scale: market.variant.id';
COMMENT ON COLUMN market.pivot_event.builder_id IS
    'The scale''s builder that wrote the event (market.builder.id): part of its identity';

-- The continuous series of each product, as for the other tables: every session's rows from its
-- front contract, for every scale that is not retired (filter on variant_id).
CREATE VIEW market.continuous_pivot_1s AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, p.*
FROM market.front_session f
JOIN market.pivot_1s p
  ON p.contract_id = f.contract_id
 AND p.slot_ordinal BETWEEN f.first_ordinal AND f.last_ordinal
 AND p.end_ns > f.open_ns AND p.end_ns <= f.close_ns
JOIN market.variant v ON v.id = p.variant_id AND v.retired_at IS NULL;
COMMENT ON VIEW market.continuous_pivot_1s IS
    'Fast swing scales of each product session from its front contract';

CREATE VIEW market.continuous_pivot_1m AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, p.*
FROM market.front_session f
JOIN market.pivot_1m p
  ON p.contract_id = f.contract_id
 AND p.slot_ordinal BETWEEN (f.first_ordinal + 59) / 60 AND f.last_ordinal / 60
 AND p.end_ns > f.open_ns AND p.end_ns <= f.close_ns
JOIN market.variant v ON v.id = p.variant_id AND v.retired_at IS NULL;
COMMENT ON VIEW market.continuous_pivot_1m IS
    'Slow swing scales of each product session from its front contract';

CREATE VIEW market.continuous_pivot_event AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, v.stage, v.name AS scale, e.*
FROM market.front_session f
JOIN market.pivot_event e
  ON e.contract_id = f.contract_id
 AND e.end_ns > f.open_ns AND e.end_ns <= f.close_ns
JOIN market.variant v ON v.id = e.variant_id AND v.retired_at IS NULL;
COMMENT ON VIEW market.continuous_pivot_event IS
    'Swing events of each product session from its front contract, with the scale''s name';
