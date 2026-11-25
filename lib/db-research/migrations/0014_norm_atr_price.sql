-- The normalizing ATR in price units (roadmap decision 23; PR #101 review): the swing stages
-- froze atr_price times a factor, which is zero where the ATR itself is exactly zero, so a
-- market that had stopped moving kept its swing detector idle. They now read norm_atr_price:
-- atr_price, or the last sampled book spread where that is larger. spread_atr also divides by
-- the floored normalizer. The volatility and swing stages are rebuilt.

ALTER TABLE market.vol_1s ADD COLUMN norm_atr_price double precision;
ALTER TABLE market.vol_10s ADD COLUMN norm_atr_price double precision;
ALTER TABLE market.vol_1m ADD COLUMN norm_atr_price double precision;

DROP VIEW market.continuous_vol_1s;
CREATE VIEW market.continuous_vol_1s AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, v.*
FROM market.front_session f
JOIN market.vol_1s v
  ON v.contract_id = f.contract_id
 AND v.slot_ordinal BETWEEN f.first_ordinal AND f.last_ordinal
 AND v.end_ns > f.open_ns AND v.end_ns <= f.close_ns;
COMMENT ON VIEW market.continuous_vol_1s IS
    '1m@1s volatility family of each product session from its front contract';

DROP VIEW market.continuous_vol_10s;
CREATE VIEW market.continuous_vol_10s AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, v.*
FROM market.front_session f
JOIN market.vol_10s v
  ON v.contract_id = f.contract_id
 AND v.slot_ordinal BETWEEN (f.first_ordinal + 9) / 10 AND f.last_ordinal / 10
 AND v.end_ns > f.open_ns AND v.end_ns <= f.close_ns;
COMMENT ON VIEW market.continuous_vol_10s IS
    '10m@10s volatility family of each product session from its front contract';

DROP VIEW market.continuous_vol_1m;
CREATE VIEW market.continuous_vol_1m AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, v.*
FROM market.front_session f
JOIN market.vol_1m v
  ON v.contract_id = f.contract_id
 AND v.slot_ordinal BETWEEN (f.first_ordinal + 59) / 60 AND f.last_ordinal / 60
 AND v.end_ns > f.open_ns AND v.end_ns <= f.close_ns;
COMMENT ON VIEW market.continuous_vol_1m IS
    '1h@1m volatility family of each product session from its front contract';
