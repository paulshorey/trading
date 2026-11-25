-- Every experiment run is recorded before it starts, with the settings it was frozen with, so
-- that the variants tried on a period can be counted beside any result chosen from them
-- (docs/project/roadmap.md, how results are judged). The first writer is `research yardstick`.

CREATE TABLE research.run (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind text NOT NULL,
    products text[] NOT NULL,
    period daterange NOT NULL,
    settings jsonb NOT NULL,
    code_sha256 text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    result jsonb
);
COMMENT ON TABLE research.run IS
    'One row per experiment run, written when it starts: its kind, products, period, frozen settings, and the code that ran it; the result is added when it finishes';
COMMENT ON COLUMN research.run.kind IS 'The experiment, for example yardstick';
COMMENT ON COLUMN research.run.settings IS 'Everything that was fixed before the run read an outcome';
COMMENT ON COLUMN research.run.code_sha256 IS 'Hash of the Python source that ran it';
COMMENT ON COLUMN research.run.result IS 'The report; NULL while running or if the run failed';
CREATE INDEX run_kind_started ON research.run (kind, started_at);
