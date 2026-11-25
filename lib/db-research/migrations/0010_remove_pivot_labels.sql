-- The outcome labels of swing candidates are removed (roadmap decision 29, November 23, 2026):
-- no model predicts a reversal, so nothing reads them. Their stages (strategy_core
-- stage_pivot_label and pivot_labels) and the commands that read the tables (research
-- benchmark, research replay) were removed with this migration; the results they gave are
-- recorded in docs/project/build-log.md and docs/project/replay.md. Every other table is
-- unchanged. The fast swing scales no longer keep a row at each label's decision row
-- (pipeline.STORED_ROWS), so ingest rewrites market.pivot_1s once.

DROP VIEW market.continuous_pivot_label_1s;
DROP VIEW market.continuous_pivot_label_10s;
DROP VIEW market.continuous_pivot_label_1m;
DROP TABLE market.pivot_label_1s;
DROP TABLE market.pivot_label_10s;
DROP TABLE market.pivot_label_1m;

DELETE FROM market.stage_slice WHERE stage LIKE 'pivot\_label\_%';
DELETE FROM market.column_registry WHERE stage LIKE 'pivot\_label\_%';
DELETE FROM market.variant WHERE stage LIKE 'pivot\_label\_%';
