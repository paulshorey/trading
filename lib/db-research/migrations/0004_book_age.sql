-- The age of the sampled book. TBBO shows the book only at trades, and a trade with an
-- unusable book (crossed or undefined) does not refresh it, so the last trade's time is
-- not always the book's time.
ALTER TABLE market.bar_1s ADD COLUMN quote_at_ns bigint;
ALTER TABLE market.candle_1m_1s ADD COLUMN book_age_s double precision;

-- The continuous views select table.*, fixed when they were created: recreate them.
DROP VIEW market.continuous_bar_1s;
DROP VIEW market.continuous_candle_1m_1s;

CREATE VIEW market.continuous_bar_1s AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, b.*
FROM market.front_session f
JOIN market.bar_1s b
  ON b.contract_id = f.contract_id
 AND b.slot_ordinal BETWEEN f.first_ordinal AND f.last_ordinal
 AND b.end_ns > f.open_ns AND b.end_ns <= f.close_ns;
COMMENT ON VIEW market.continuous_bar_1s IS
    'One-second rows of each product session from its front contract: one series per product';

CREATE VIEW market.continuous_candle_1m_1s AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, k.*
FROM market.front_session f
JOIN market.candle_1m_1s k
  ON k.contract_id = f.contract_id
 AND k.slot_ordinal BETWEEN f.first_ordinal AND f.last_ordinal
 AND k.end_ns > f.open_ns AND k.end_ns <= f.close_ns;
COMMENT ON VIEW market.continuous_candle_1m_1s IS
    '1m@1s candles and features of each product session from its front contract';
