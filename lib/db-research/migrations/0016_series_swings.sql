-- The swings and structure of RSI and of net volume flow (CVD) on every timeframe, each
-- measured in its own ATR (roadmap decision 41; docs/project/series-structure-spec.md;
-- strategy_core.stage_step_series). A series has one value per step row, at the row's close:
-- candle_<window>.rsi or bar_<rows>.cvd. Each scale (<stream>_rsi_atr_<k>, <stream>_cvd_atr_<k>)
-- is a variant with one row per step row; its events go to market.pivot_event with price's.
--
-- The columns are those of a price scale that apply to a series. ext, high_level and low_level
-- are the levels in the series' units: RSI points (a feature) or contracts (context, never a
-- model input). theta is the frozen threshold in the same units. Values "in ATRs" divide by
-- the series' own ATR floored at half the smallest swing. The fast tables hold the last second
-- of every ten-second row only (the engine computes every second).
-- Monthly partitions on end_ns are created by the ingest command.

CREATE TABLE market.pivot_rsi_1m (
    contract_id bigint NOT NULL,
    slot_ordinal bigint NOT NULL,
    end_ns bigint NOT NULL,
    ext double precision,
    high_level double precision,
    low_level double precision,
    progress double precision,
    theta double precision,
    ext_dist_atr double precision,
    leg_atr double precision,
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
    state smallint NOT NULL,
    dir smallint,
    trend smallint,
    high_class smallint,
    prov_lh smallint,
    low_class smallint,
    prov_hl smallint,
    structure smallint CHECK (structure BETWEEN 0 AND 8),
    variant_id smallint NOT NULL,
    phase smallint GENERATED ALWAYS AS ((slot_ordinal % 60)::smallint) VIRTUAL,
    PRIMARY KEY (contract_id, variant_id, slot_ordinal, end_ns)
) PARTITION BY RANGE (end_ns);
CREATE INDEX pivot_rsi_1m_end ON market.pivot_rsi_1m USING brin (end_ns);
COMMENT ON COLUMN market.pivot_rsi_1m.variant_id IS 'The scale: market.variant.id';
COMMENT ON TABLE market.pivot_rsi_1m IS
    'Slow RSI scales: turning points of the 1h@1m RSI sized by its own ATR';

CREATE TABLE market.pivot_rsi_10s (LIKE market.pivot_rsi_1m INCLUDING ALL)
    PARTITION BY RANGE (end_ns);
COMMENT ON TABLE market.pivot_rsi_10s IS
    'Middle RSI scales: turning points of the 10m@10s RSI sized by its own ATR';

CREATE TABLE market.pivot_rsi_1s (LIKE market.pivot_rsi_1m INCLUDING ALL)
    PARTITION BY RANGE (end_ns);
COMMENT ON TABLE market.pivot_rsi_1s IS
    'Fast RSI scales (1m@1s RSI, its own ATR), stored at ten-second ends';

CREATE TABLE market.pivot_cvd_1m (LIKE market.pivot_rsi_1m INCLUDING ALL)
    PARTITION BY RANGE (end_ns);
COMMENT ON TABLE market.pivot_cvd_1m IS
    'Slow CVD scales: turning points of net volume flow per minute, sized by its own ATR';

CREATE TABLE market.pivot_cvd_10s (LIKE market.pivot_rsi_1m INCLUDING ALL)
    PARTITION BY RANGE (end_ns);
COMMENT ON TABLE market.pivot_cvd_10s IS
    'Middle CVD scales: turning points of net volume flow per ten seconds, in its own ATR';

CREATE TABLE market.pivot_cvd_1s (LIKE market.pivot_rsi_1m INCLUDING ALL)
    PARTITION BY RANGE (end_ns);
COMMENT ON TABLE market.pivot_cvd_1s IS
    'Fast CVD scales (net volume flow per second, its own ATR), stored at ten-second ends';

-- The continuous series of each product: every session's rows from its front contract.

CREATE VIEW market.continuous_pivot_rsi_1s AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, p.*
FROM market.front_session f
JOIN market.pivot_rsi_1s p
  ON p.contract_id = f.contract_id
 AND p.slot_ordinal BETWEEN f.first_ordinal AND f.last_ordinal
 AND p.end_ns > f.open_ns AND p.end_ns <= f.close_ns
JOIN market.variant v ON v.id = p.variant_id AND v.retired_at IS NULL;
COMMENT ON VIEW market.continuous_pivot_rsi_1s IS
    'Fast RSI swing scales of each product session from its front contract';

CREATE VIEW market.continuous_pivot_rsi_10s AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, p.*
FROM market.front_session f
JOIN market.pivot_rsi_10s p
  ON p.contract_id = f.contract_id
 AND p.slot_ordinal BETWEEN (f.first_ordinal + 9) / 10 AND f.last_ordinal / 10
 AND p.end_ns > f.open_ns AND p.end_ns <= f.close_ns
JOIN market.variant v ON v.id = p.variant_id AND v.retired_at IS NULL;
COMMENT ON VIEW market.continuous_pivot_rsi_10s IS
    'Middle RSI swing scales of each product session from its front contract';

CREATE VIEW market.continuous_pivot_rsi_1m AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, p.*
FROM market.front_session f
JOIN market.pivot_rsi_1m p
  ON p.contract_id = f.contract_id
 AND p.slot_ordinal BETWEEN (f.first_ordinal + 59) / 60 AND f.last_ordinal / 60
 AND p.end_ns > f.open_ns AND p.end_ns <= f.close_ns
JOIN market.variant v ON v.id = p.variant_id AND v.retired_at IS NULL;
COMMENT ON VIEW market.continuous_pivot_rsi_1m IS
    'Slow RSI swing scales of each product session from its front contract';

CREATE VIEW market.continuous_pivot_cvd_1s AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, p.*
FROM market.front_session f
JOIN market.pivot_cvd_1s p
  ON p.contract_id = f.contract_id
 AND p.slot_ordinal BETWEEN f.first_ordinal AND f.last_ordinal
 AND p.end_ns > f.open_ns AND p.end_ns <= f.close_ns
JOIN market.variant v ON v.id = p.variant_id AND v.retired_at IS NULL;
COMMENT ON VIEW market.continuous_pivot_cvd_1s IS
    'Fast CVD swing scales of each product session from its front contract';

CREATE VIEW market.continuous_pivot_cvd_10s AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, p.*
FROM market.front_session f
JOIN market.pivot_cvd_10s p
  ON p.contract_id = f.contract_id
 AND p.slot_ordinal BETWEEN (f.first_ordinal + 9) / 10 AND f.last_ordinal / 10
 AND p.end_ns > f.open_ns AND p.end_ns <= f.close_ns
JOIN market.variant v ON v.id = p.variant_id AND v.retired_at IS NULL;
COMMENT ON VIEW market.continuous_pivot_cvd_10s IS
    'Middle CVD swing scales of each product session from its front contract';

CREATE VIEW market.continuous_pivot_cvd_1m AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, p.*
FROM market.front_session f
JOIN market.pivot_cvd_1m p
  ON p.contract_id = f.contract_id
 AND p.slot_ordinal BETWEEN (f.first_ordinal + 59) / 60 AND f.last_ordinal / 60
 AND p.end_ns > f.open_ns AND p.end_ns <= f.close_ns
JOIN market.variant v ON v.id = p.variant_id AND v.retired_at IS NULL;
COMMENT ON VIEW market.continuous_pivot_cvd_1m IS
    'Slow CVD swing scales of each product session from its front contract';
