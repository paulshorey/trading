-- name: select_recent_candles
-- Replace {{TABLE_NAME}} with target table (for example candles_1m_1s or candles_1h_1m).
SELECT *
FROM {{TABLE_NAME}}
WHERE ticker = $1
ORDER BY time DESC
LIMIT $2;
