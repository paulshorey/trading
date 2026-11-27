-- Where each second is in time (roadmap decision 43; docs/project/clock-spec.md;
-- strategy_core.stage_clock): the time of day in the market time zone, the session's
-- progress, the product's main market hours, and the day of the week. Computed from the
-- calendar and the product alone; no price or trade is read. One row per scheduled-open
-- second and contract, stored at the end of every ten-second row (the engine computes every
-- second). Monthly partitions on end_ns are created by the ingest command.

CREATE TABLE market.clock_1s (
    contract_id bigint NOT NULL,
    slot_ordinal bigint NOT NULL,
    end_ns bigint NOT NULL,
    tod_sin double precision,
    tod_cos double precision,
    session_left_s double precision,
    session_frac double precision,
    session_short double precision,
    main_open_s double precision,
    main_close_s double precision,
    in_main double precision,
    weekday double precision,
    phase smallint GENERATED ALWAYS AS ((slot_ordinal % 60)::smallint) VIRTUAL,
    PRIMARY KEY (contract_id, slot_ordinal, end_ns)
) PARTITION BY RANGE (end_ns);
CREATE INDEX clock_1s_end ON market.clock_1s USING brin (end_ns);
COMMENT ON TABLE market.clock_1s IS
    'Clock and session inputs of each second, stored at ten-second ends';

CREATE VIEW market.continuous_clock_1s AS
SELECT f.product, f.trade_date, f.contract, f.roll_basis, f.rolled, k.*
FROM market.front_session f
JOIN market.clock_1s k
  ON k.contract_id = f.contract_id
 AND k.slot_ordinal BETWEEN f.first_ordinal AND f.last_ordinal
 AND k.end_ns > f.open_ns AND k.end_ns <= f.close_ns;
COMMENT ON VIEW market.continuous_clock_1s IS
    'Clock and session inputs of each product session from its front contract';
