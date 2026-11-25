-- Base changes of build-order item 10 (docs/project/roadmap.md):
--
-- 1. cvd: buy - sell volume through the life of a contract, on every step's rows. session_cvd
--    restarts at each session open; cvd never does, so a swing of it can cross the daily break
--    (decision 41). Both stay stored.
-- 2. norm_atr_bps: the ATR that normalizes values in ATRs, floored at the last sampled book
--    spread (decision 23; strategy_core.normalizer). atr_bps is unchanged.
--
-- Every stage's code or inputs changed, so ingest rebuilds every table once.

ALTER TABLE market.bar_1s ADD COLUMN cvd bigint;
ALTER TABLE market.bar_10s ADD COLUMN cvd bigint;
ALTER TABLE market.bar_1m ADD COLUMN cvd bigint;
ALTER TABLE market.candle_1m_1s ADD COLUMN norm_atr_bps double precision;
ALTER TABLE market.candle_10m_10s ADD COLUMN norm_atr_bps double precision;
ALTER TABLE market.candle_1h_1m ADD COLUMN norm_atr_bps double precision;

-- The continuous views select b.* or k.*, which was expanded when they were created: recreate
-- them so that they carry the new columns.

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

DROP VIEW market.continuous_bar_10s;
CREATE VIEW market.continuous_bar_10s AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, b.*
FROM market.front_session f
JOIN market.bar_10s b
  ON b.contract_id = f.contract_id
 AND b.slot_ordinal BETWEEN (f.first_ordinal + 9) / 10 AND f.last_ordinal / 10
 AND b.end_ns > f.open_ns AND b.end_ns <= f.close_ns;
COMMENT ON VIEW market.continuous_bar_10s IS
    'Ten-second rows of each product session from its front contract: one series per product';

DROP VIEW market.continuous_bar_1m;
CREATE VIEW market.continuous_bar_1m AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, b.*
FROM market.front_session f
JOIN market.bar_1m b
  ON b.contract_id = f.contract_id
 AND b.slot_ordinal BETWEEN (f.first_ordinal + 59) / 60 AND f.last_ordinal / 60
 AND b.end_ns > f.open_ns AND b.end_ns <= f.close_ns;
COMMENT ON VIEW market.continuous_bar_1m IS
    'One-minute rows of each product session from its front contract: one series per product';

DROP VIEW market.continuous_candle_1m_1s;
CREATE VIEW market.continuous_candle_1m_1s AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, k.*
FROM market.front_session f
JOIN market.candle_1m_1s k
  ON k.contract_id = f.contract_id
 AND k.slot_ordinal BETWEEN f.first_ordinal AND f.last_ordinal
 AND k.end_ns > f.open_ns AND k.end_ns <= f.close_ns;
COMMENT ON VIEW market.continuous_candle_1m_1s IS
    '1m@1s candles and features of each product session from its front contract';

DROP VIEW market.continuous_candle_10m_10s;
CREATE VIEW market.continuous_candle_10m_10s AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, k.*
FROM market.front_session f
JOIN market.candle_10m_10s k
  ON k.contract_id = f.contract_id
 AND k.slot_ordinal BETWEEN (f.first_ordinal + 9) / 10 AND f.last_ordinal / 10
 AND k.end_ns > f.open_ns AND k.end_ns <= f.close_ns;
COMMENT ON VIEW market.continuous_candle_10m_10s IS
    '10m@10s candles and features of each product session from its front contract';

DROP VIEW market.continuous_candle_1h_1m;
CREATE VIEW market.continuous_candle_1h_1m AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, k.*
FROM market.front_session f
JOIN market.candle_1h_1m k
  ON k.contract_id = f.contract_id
 AND k.slot_ordinal BETWEEN (f.first_ordinal + 59) / 60 AND f.last_ordinal / 60
 AND k.end_ns > f.open_ns AND k.end_ns <= f.close_ns;
COMMENT ON VIEW market.continuous_candle_1h_1m IS
    '1h@1m candles and features of each product session from its front contract';
