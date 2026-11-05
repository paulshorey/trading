-- PR C2: the volatility family of the rolling 1m@1s window, a new stage
-- (strategy_core.stage_vol_1s, calculations in strategy_core.volatility, shared with vol_1m)
-- reading bar_1s and candle_1m_1s. Every other table is unchanged; ingest adds this one without
-- rewriting them.

-- One row per scheduled-open second per contract, for the window of second rows o - 59 ... o:
-- the same columns as market.vol_1m (ATR(5) and ATR(50) and their log ratios to
-- candle_1m_1s.atr_bps, ATR(14), not stored again; bullish and bearish ATR and their skew; long
-- and short adverse-excursion ATR and this window's excursions; the window's extremes as levels;
-- the time-of-day ATR normal; the daily scale; this window's true range, Parkinson and
-- Garman-Klass volatility, and spread against ATR), plus realized volatility from the window's
-- one-second returns, in bps and against ATR, with its return count. ATR in price units and
-- dollars per contract are context, never features. Averages are NULL unless defined for a
-- complete or carried empty window, values of the window itself unless it is complete. Monthly
-- partitions on end_ns are created by the ingest command; columns are ordered by width.
CREATE TABLE market.vol_1s (
    contract_id bigint NOT NULL,
    slot_ordinal bigint NOT NULL,
    end_ns bigint NOT NULL,
    atr_price double precision,
    atr_usd double precision,
    atr5_bps double precision,
    atr50_bps double precision,
    atr_5_14_log double precision,
    atr_14_50_log double precision,
    bull_atr_bps double precision,
    bear_atr_bps double precision,
    bull_bear_skew double precision,
    long_adverse_atr_bps double precision,
    short_adverse_atr_bps double precision,
    long_excursion_atr double precision,
    short_excursion_atr double precision,
    high_dist_atr double precision,
    low_dist_atr double precision,
    high_age_s double precision,
    low_age_s double precision,
    extreme_order double precision,
    atr_tod_log double precision,
    day_atr_bps double precision,
    day_range_ratio double precision,
    day_high_dist double precision,
    day_low_dist double precision,
    day_atr_pct double precision,
    tr_atr double precision,
    parkinson_bps double precision,
    gk_bps double precision,
    spread_atr double precision,
    rv_bps double precision,
    rv_atr double precision,
    status smallint NOT NULL,
    rv_returns smallint,
    phase smallint GENERATED ALWAYS AS ((slot_ordinal % 60)::smallint) VIRTUAL,
    PRIMARY KEY (contract_id, slot_ordinal, end_ns)
) PARTITION BY RANGE (end_ns);
CREATE INDEX vol_1s_end ON market.vol_1s USING brin (end_ns);

-- The continuous series of each product, as for the other second tables: every session's rows
-- from its front contract.
CREATE VIEW market.continuous_vol_1s AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, v.*
FROM market.front_session f
JOIN market.vol_1s v
  ON v.contract_id = f.contract_id
 AND v.slot_ordinal BETWEEN f.first_ordinal AND f.last_ordinal
 AND v.end_ns > f.open_ns AND v.end_ns <= f.close_ns;
COMMENT ON VIEW market.continuous_vol_1s IS
    '1m@1s volatility family of each product session from its front contract';
