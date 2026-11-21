-- Every timeframe is built by the same stage classes (strategy_core.stage_step_*.py): 1m@1s
-- joins 10m@10s and 1h@1m. Three things follow for the one-second tables.

-- 1. The window statistics exist for every timeframe, so 1m@1s gets its table, with the
-- columns of stats_1h_1m. Its "minute" columns count one-second rows (as stats_10m_10s counts
-- ten-second rows).
CREATE TABLE market.stats_1m_1s (LIKE market.stats_1h_1m INCLUDING ALL)
    PARTITION BY RANGE (end_ns);
COMMENT ON TABLE market.stats_1m_1s IS
    'Statistics of the rolling 1m@1s window; columns named for minutes count one-second rows';

CREATE VIEW market.continuous_stats_1m_1s AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, s.*
FROM market.front_session f
JOIN market.stats_1m_1s s
  ON s.contract_id = f.contract_id
 AND s.slot_ordinal BETWEEN f.first_ordinal AND f.last_ordinal
 AND s.end_ns > f.open_ns AND s.end_ns <= f.close_ns;
COMMENT ON VIEW market.continuous_stats_1m_1s IS
    '1m@1s window statistics of each product session from its front contract';

-- 2. Realized volatility is a window statistic on every timeframe: rv_bps, rv_atr, and
-- rv_returns move from vol_1s to stats_1m_1s, with the same values. The view names its
-- columns, so it is made again.
DROP VIEW market.continuous_vol_1s;
ALTER TABLE market.vol_1s DROP COLUMN rv_bps, DROP COLUMN rv_atr, DROP COLUMN rv_returns;
CREATE VIEW market.continuous_vol_1s AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, v.*
FROM market.front_session f
JOIN market.vol_1s v
  ON v.contract_id = f.contract_id
 AND v.slot_ordinal BETWEEN f.first_ordinal AND f.last_ordinal
 AND v.end_ns > f.open_ns AND v.end_ns <= f.close_ns;
COMMENT ON VIEW market.continuous_vol_1s IS
    '1m@1s volatility family of each product session from its front contract';

-- 3. The fast swing scales read the spread where the other scales do: the last bid and ask of
-- the latest step row with a usable book, carried, never across missing data. It is the same
-- quantity as candle_1m_1s.book_spread_bps, which they read before; the recorded parameter
-- follows the source.
UPDATE market.variant
SET params = jsonb_set(params, '{spread}', '"bar_1s.last_bid, last_ask"')
WHERE stage = 'pivot_1s' AND params ->> 'spread' = 'candle_1m_1s.book_spread_bps';
