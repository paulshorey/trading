-- The structure code of every swing scale (roadmap decision 32; strategy_core.stage_step_pivot):
-- trend and breaks of the latest confirmed high and low in one number, 0..8. The 3 ATR scales
-- (fast_atr_3, mid_atr_3, slow_atr_3) are new variants written to the same tables; they need no
-- schema change. Ingest rebuilds the swing tables once, since their stages' code changed.

ALTER TABLE market.pivot_1s ADD COLUMN structure smallint CHECK (structure BETWEEN 0 AND 8);
ALTER TABLE market.pivot_10s ADD COLUMN structure smallint CHECK (structure BETWEEN 0 AND 8);
ALTER TABLE market.pivot_1m ADD COLUMN structure smallint CHECK (structure BETWEEN 0 AND 8);

-- The continuous views select p.*, which was expanded when they were created: recreate them so
-- that they carry the new column.
DROP VIEW market.continuous_pivot_1s;
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

DROP VIEW market.continuous_pivot_10s;
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

DROP VIEW market.continuous_pivot_1m;
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
