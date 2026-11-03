-- Each second's first and last trade side, so rolling windows count aggressor side pairs and
-- switches across second boundaries (the bridge from one observed second's last trade to the
-- next one's first), as they already do for the price path. 1 buy, -1 sell, 0 unknown.
ALTER TABLE market.bar_1s ADD COLUMN first_side integer;
ALTER TABLE market.bar_1s ADD COLUMN last_side integer;

-- The continuous view selects bar_1s.*, fixed when it was created: recreate it.
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
