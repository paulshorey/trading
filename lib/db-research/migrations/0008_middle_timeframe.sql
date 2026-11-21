-- The middle timeframe 10m@10s (build-order item 4): a window of 60 rows of 10 seconds, between
-- 1m@1s and 1h@1m. Its stages are the classes that build the 1h@1m ones
-- (strategy_core.stage_step_*.py) for another timeframe, so each table has exactly the columns
-- of its minute counterpart: bar_10s as bar_1m, candle_10m_10s as candle_1h_1m, and so on.
--
-- One row per scheduled-open step of 10 seconds per contract. slot_ordinal is the row's index
-- counter: row k holds the seconds with ordinals 10k - 9 ... 10k. A minute holds six rows, and
-- sessions open and close on whole minutes, so no row straddles a session boundary. phase is
-- slot_ordinal % 60, as everywhere: indicators read the same-phase windows 60 rows apart.
-- Monthly partitions on end_ns are created by the ingest command.

CREATE TABLE market.bar_10s (LIKE market.bar_1m INCLUDING ALL) PARTITION BY RANGE (end_ns);
COMMENT ON TABLE market.bar_10s IS
    'Ten-second rows, merged exactly from their ten second rows: the step rows of 10m@10s';

CREATE TABLE market.candle_10m_10s (LIKE market.candle_1h_1m INCLUDING ALL)
    PARTITION BY RANGE (end_ns);
COMMENT ON TABLE market.candle_10m_10s IS
    'The rolling 10m@10s window (ten-second rows k - 59 ... k) and its normalized features';

CREATE TABLE market.stats_10m_10s (LIKE market.stats_1h_1m INCLUDING ALL)
    PARTITION BY RANGE (end_ns);
COMMENT ON TABLE market.stats_10m_10s IS
    'Statistics of the rolling 10m@10s window; columns named for minutes count ten-second rows';

CREATE TABLE market.vol_10s (LIKE market.vol_1m INCLUDING ALL) PARTITION BY RANGE (end_ns);
COMMENT ON TABLE market.vol_10s IS 'The volatility family of the rolling 10m@10s window';

-- The middle swing scales (mid_atr_0p5, mid_atr_1, mid_atr_2), one row per ten-second row and
-- scale. Their events go to market.pivot_event with the other scales'.
CREATE TABLE market.pivot_10s (LIKE market.pivot_1m INCLUDING ALL) PARTITION BY RANGE (end_ns);
COMMENT ON TABLE market.pivot_10s IS
    'Middle swing scales: turning points of the price path sized by the 10m@10s ATR';

-- Outcome labels of the middle scales' candidates, keyed to the decision row. Labels look into
-- the future: no column is a feature, and no stage or engine reads them.
CREATE TABLE market.pivot_label_10s (LIKE market.pivot_label_1m INCLUDING ALL)
    PARTITION BY RANGE (end_ns);
COMMENT ON TABLE market.pivot_label_10s IS
    'Outcome labels of the middle swing scales'' candidates (never model inputs)';

-- The continuous series of each product: every session's rows from its front contract. The
-- ten-second rows inside a session's seconds first_ordinal ... last_ordinal are
-- (first_ordinal + 9) / 10 ... last_ordinal / 10.
CREATE VIEW market.continuous_bar_10s AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, b.*
FROM market.front_session f
JOIN market.bar_10s b
  ON b.contract_id = f.contract_id
 AND b.slot_ordinal BETWEEN (f.first_ordinal + 9) / 10 AND f.last_ordinal / 10
 AND b.end_ns > f.open_ns AND b.end_ns <= f.close_ns;
COMMENT ON VIEW market.continuous_bar_10s IS
    'Ten-second rows of each product session from its front contract: one series per product';

CREATE VIEW market.continuous_candle_10m_10s AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, k.*
FROM market.front_session f
JOIN market.candle_10m_10s k
  ON k.contract_id = f.contract_id
 AND k.slot_ordinal BETWEEN (f.first_ordinal + 9) / 10 AND f.last_ordinal / 10
 AND k.end_ns > f.open_ns AND k.end_ns <= f.close_ns;
COMMENT ON VIEW market.continuous_candle_10m_10s IS
    '10m@10s candles and features of each product session from its front contract';

CREATE VIEW market.continuous_stats_10m_10s AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, s.*
FROM market.front_session f
JOIN market.stats_10m_10s s
  ON s.contract_id = f.contract_id
 AND s.slot_ordinal BETWEEN (f.first_ordinal + 9) / 10 AND f.last_ordinal / 10
 AND s.end_ns > f.open_ns AND s.end_ns <= f.close_ns;
COMMENT ON VIEW market.continuous_stats_10m_10s IS
    '10m@10s window statistics of each product session from its front contract';

CREATE VIEW market.continuous_vol_10s AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, v.*
FROM market.front_session f
JOIN market.vol_10s v
  ON v.contract_id = f.contract_id
 AND v.slot_ordinal BETWEEN (f.first_ordinal + 9) / 10 AND f.last_ordinal / 10
 AND v.end_ns > f.open_ns AND v.end_ns <= f.close_ns;
COMMENT ON VIEW market.continuous_vol_10s IS
    '10m@10s volatility family of each product session from its front contract';

CREATE VIEW market.continuous_pivot_10s AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, p.*
FROM market.front_session f
JOIN market.pivot_10s p
  ON p.contract_id = f.contract_id
 AND p.slot_ordinal BETWEEN (f.first_ordinal + 9) / 10 AND f.last_ordinal / 10
 AND p.end_ns > f.open_ns AND p.end_ns <= f.close_ns
JOIN market.variant v ON v.id = p.variant_id AND v.retired_at IS NULL;
COMMENT ON VIEW market.continuous_pivot_10s IS
    'Middle swing scales of each product session from its front contract';

CREATE VIEW market.continuous_pivot_label_10s AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, l.*
FROM market.front_session f
JOIN market.pivot_label_10s l
  ON l.contract_id = f.contract_id
 AND l.slot_ordinal BETWEEN (f.first_ordinal + 9) / 10 AND f.last_ordinal / 10
 AND l.end_ns > f.open_ns AND l.end_ns <= f.close_ns
JOIN market.variant v ON v.id = l.variant_id AND v.retired_at IS NULL;
COMMENT ON VIEW market.continuous_pivot_label_10s IS
    'Labels of each product session from its front contract (join market.variant for the label ID)';
