-- PR B2: statistics of the rolling 1h@1m window that are not window sums of second statistics,
-- a new stage (strategy_core.stage_stats_1h_1m) reading bar_1m and candle_1h_1m. Every other
-- table is unchanged; ingest adds this one without rewriting them.

-- One row per scheduled-open minute per contract, for the window of minute rows m - 59 ... m:
-- realized volatility from one-second returns, statistics of the minute returns, the path's
-- drawdown, drawup, and extreme positions, the close against the session VWAP and the previous
-- session's levels, and the correlation of minute closes with cumulative delta. Features are
-- NULL unless the hourly window is complete. Monthly partitions on end_ns are created by the
-- ingest command; columns are ordered by width.
CREATE TABLE market.stats_1h_1m (
    contract_id bigint NOT NULL,
    slot_ordinal bigint NOT NULL,
    end_ns bigint NOT NULL,
    prior_high bigint,
    prior_low bigint,
    prior_close bigint,
    session_vwap double precision,
    rv_bps double precision,
    rv_atr double precision,
    ret_std_bps double precision,
    ret_skew double precision,
    ret_autocorr double precision,
    vr_5 double precision,
    up_minute_ratio double precision,
    drawdown_atr double precision,
    drawup_atr double precision,
    high_pos double precision,
    low_pos double precision,
    session_vwap_atr double precision,
    prior_high_atr double precision,
    prior_low_atr double precision,
    prior_close_atr double precision,
    cvd_close_corr double precision,
    status smallint NOT NULL,
    rv_returns smallint,
    minute_returns smallint,
    phase smallint GENERATED ALWAYS AS ((slot_ordinal % 60)::smallint) VIRTUAL,
    PRIMARY KEY (contract_id, slot_ordinal, end_ns)
) PARTITION BY RANGE (end_ns);
CREATE INDEX stats_1h_1m_end ON market.stats_1h_1m USING brin (end_ns);

-- The continuous series of each product, as for the other minute tables: every session's rows
-- from its front contract, the minutes (first_ordinal + 59) / 60 ... last_ordinal / 60.
CREATE VIEW market.continuous_stats_1h_1m AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, s.*
FROM market.front_session f
JOIN market.stats_1h_1m s
  ON s.contract_id = f.contract_id
 AND s.slot_ordinal BETWEEN (f.first_ordinal + 59) / 60 AND f.last_ordinal / 60
 AND s.end_ns > f.open_ns AND s.end_ns <= f.close_ns;
COMMENT ON VIEW market.continuous_stats_1h_1m IS
    '1h@1m window statistics of each product session from its front contract';
