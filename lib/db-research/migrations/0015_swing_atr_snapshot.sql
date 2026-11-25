-- The swing variants' registered parameters name the frozen ATR's source. Migration 0014
-- changed it from vol_*.atr_price to vol_*.norm_atr_price (the ATR floored at the spread),
-- and every swing row is rebuilt under it, so the names keep their meaning: 3 ATR is still
-- 3 ATR, of the normalizing ATR that every other value in ATRs already divides by.

UPDATE market.variant
SET params = jsonb_set(
    params, '{atr_snapshot}',
    to_jsonb(replace(params ->> 'atr_snapshot', '.atr_price', '.norm_atr_price'))
)
WHERE stage IN ('pivot_1s', 'pivot_10s', 'pivot_1m')
  AND params ->> 'atr_snapshot' LIKE '%.atr_price';
