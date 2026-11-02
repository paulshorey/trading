-- One continuous series per product: each session's rows come from that session's front
-- contract (market.roll), so 'GC' reads as one permanent series across contract rolls.
-- Rows stay stored per contract; nothing is merged across delivery months, whose prices
-- differ. Contracts of a product share the calendar, so slot_ordinal continues across rolls
-- with exactly one row per scheduled-open second. Features of each row come from its own
-- contract's history (warmed by lead sessions), so a roll adds no artificial move to them;
-- raw prices jump by the difference between the months, flagged by `rolled`.
-- Recreate these views in a later migration when the tables gain columns.

ALTER TABLE market.roll DROP CONSTRAINT roll_basis_check;
ALTER TABLE market.roll ADD CONSTRAINT roll_basis_check
    CHECK (basis IN ('previous_session', 'forward_only', 'kept', 'same_session'));
COMMENT ON COLUMN market.roll.basis IS
    'previous_session: most volume in the complete previous session; forward_only: the most '
    'volume was an earlier delivery month, front unchanged; kept: previous session incomplete, '
    'front unchanged; same_session: first session with data (not causal)';

-- Each session's front contract and, once ingested, the index counters of its stored rows.
CREATE VIEW market.front_session AS
SELECT r.product,
       r.trade_date,
       r.contract_id,
       c.raw_symbol AS contract,
       r.basis AS roll_basis,
       r.contract_id IS DISTINCT FROM lag(r.contract_id) OVER w AS rolled,
       s.open_ns,
       s.close_ns,
       s.first_ordinal,
       s.last_ordinal
FROM market.roll r
JOIN market.contract c ON c.id = r.contract_id
LEFT JOIN market.ingest_slice s ON s.contract_id = r.contract_id AND s.trade_date = r.trade_date
WINDOW w AS (PARTITION BY r.product ORDER BY r.trade_date);
COMMENT ON VIEW market.front_session IS
    'Front contract per product session; first_ordinal is NULL until the session is ingested';
COMMENT ON COLUMN market.front_session.rolled IS
    'True on the first session of a new front contract (raw prices jump to the new month)';

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
