-- Contracts, rolls, ingestion bookkeeping, the stored one-second rows, and one continuous
-- series per product. docs/project/ingestion.md describes the tables; strategy_core.rows
-- defines every column of market.bar_1s and market.candle_1m_1s (tests compare them with
-- this file's result).

-- One row per futures contract. Raw symbols repeat each decade, so the delivery month is part
-- of the key. Expiration comes from Databento definition records once they are loaded.
CREATE TABLE market.contract (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product text NOT NULL,
    raw_symbol text NOT NULL,
    contract_month date NOT NULL CHECK (extract(day FROM contract_month) = 1),
    dataset text NOT NULL,
    tick_size bigint NOT NULL CHECK (tick_size > 0),
    tick_value double precision NOT NULL,
    expiration timestamptz,
    UNIQUE (product, raw_symbol, contract_month)
);

-- Outright volume per session, read from the DBN files once, and the front contract of each
-- session derived from it (the backtest roll rule: most volume in the previous session).
CREATE TABLE market.session_scan (
    product text NOT NULL,
    trade_date date NOT NULL,
    open_ns bigint NOT NULL,
    close_ns bigint NOT NULL,
    complete boolean NOT NULL,
    source_files jsonb NOT NULL,
    scan_sha256 text NOT NULL,  -- code and settings that computed the volumes
    scanned_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (product, trade_date)
);
CREATE TABLE market.session_volume (
    product text NOT NULL,
    trade_date date NOT NULL,
    contract_id bigint NOT NULL REFERENCES market.contract (id),
    volume bigint NOT NULL CHECK (volume > 0),
    PRIMARY KEY (product, trade_date, contract_id),
    FOREIGN KEY (product, trade_date) REFERENCES market.session_scan ON DELETE CASCADE
);
CREATE TABLE market.roll (
    product text NOT NULL,
    trade_date date NOT NULL,
    contract_id bigint NOT NULL REFERENCES market.contract (id),
    basis text NOT NULL
        CHECK (basis IN ('previous_session', 'forward_only', 'kept', 'same_session')),
    PRIMARY KEY (product, trade_date)
);
COMMENT ON COLUMN market.roll.basis IS
    'previous_session: most volume in the complete previous session; forward_only: the most '
    'volume was an earlier delivery month, front unchanged; kept: previous session incomplete, '
    'front unchanged; same_session: first session of a downloaded range (not causal)';

-- Builder versions: code digest and settings that determine stored values.
CREATE TABLE market.builder (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sha256 text NOT NULL UNIQUE CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    product text NOT NULL,
    code_sha256 text NOT NULL,
    settings jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE market.ingest_run (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    command jsonb NOT NULL,
    status text NOT NULL CHECK (status IN ('running', 'done', 'partial', 'failed')),
    summary jsonb,
    error text
);

-- One row per stored (contract, session): what built it, from which files, its quality
-- report, and the builder checkpoint after the session, from which the next session resumes.
CREATE TABLE market.ingest_slice (
    contract_id bigint NOT NULL REFERENCES market.contract (id),
    trade_date date NOT NULL,
    builder_id bigint NOT NULL REFERENCES market.builder (id),
    run_id bigint NOT NULL REFERENCES market.ingest_run (id),
    open_ns bigint NOT NULL,
    close_ns bigint NOT NULL,
    first_ordinal bigint NOT NULL,
    last_ordinal bigint NOT NULL,
    row_count integer NOT NULL,
    observed integer NOT NULL,
    missing integer NOT NULL,
    report jsonb NOT NULL,
    source_files jsonb NOT NULL,
    state bytea NOT NULL,
    build_seconds real NOT NULL,
    ingested_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (contract_id, trade_date)
);
CREATE INDEX ingest_slice_builder ON market.ingest_slice (builder_id);

-- One row per scheduled-open second per contract, including seconds without trades or data.
-- slot_ordinal is the index counter: windows and phases are arithmetic on it, never on time.
-- Monthly partitions on end_ns are created by the ingest command. No foreign key to
-- market.contract: per-row checks would slow bulk COPY; ingest writes only known contracts.
-- Columns are ordered by width so rows carry no alignment padding.
CREATE TABLE market.bar_1s (
    contract_id bigint NOT NULL,
    slot_ordinal bigint NOT NULL,
    end_ns bigint NOT NULL,
    open bigint,
    high bigint,
    low bigint,
    close bigint,
    high_at_ns bigint,
    low_at_ns bigint,
    pv double precision,
    session_cvd bigint,
    size_sq bigint,
    first_at_ns bigint,
    last_at_ns bigint,
    path_abs bigint,
    spread_sum bigint,
    spread_max bigint,
    mid2_open bigint,
    mid2_high bigint,
    mid2_low bigint,
    last_bid bigint,
    last_ask bigint,
    quote_at_ns bigint,
    eff_spread_sum bigint,
    bid_depth_sum bigint,
    ask_depth_sum bigint,
    order_bid_size_sum bigint,
    order_ask_size_sum bigint,
    depth_at_ns bigint,
    imbalance_sum double precision,
    imbalance_volume_sum double precision,
    imbalance_last double precision,
    tilt_sum double precision,
    buy_take_sum double precision,
    sell_take_sum double precision,
    alignment_sum double precision,
    order_imbalance_sum double precision,
    volume integer,
    buy_volume integer,
    sell_volume integer,
    trades integer,
    delta_high integer,
    delta_low integer,
    buy_trades integer,
    sell_trades integer,
    max_size integer,
    upticks integer,
    downticks integer,
    side_pairs integer,
    side_switches integer,
    sweep_buy_volume integer,
    sweep_sell_volume integer,
    quote_trades integer,
    quote_volume integer,
    known_quote_volume integer,
    depth_trades integer,
    depth_volume integer,
    known_depth_volume integer,
    order_trades integer,
    last_bid_size integer,
    last_ask_size integer,
    bid_orders_sum integer,
    ask_orders_sum integer,
    bad_book_trades integer,
    late_trades integer,
    status smallint NOT NULL,
    phase smallint GENERATED ALWAYS AS ((slot_ordinal % 60)::smallint) VIRTUAL,
    PRIMARY KEY (contract_id, slot_ordinal, end_ns)
) PARTITION BY RANGE (end_ns);
CREATE INDEX bar_1s_end ON market.bar_1s USING brin (end_ns);

-- The rolling 1m@1s candle of rows o - 59 ... o and its normalized features, one per second.
CREATE TABLE market.candle_1m_1s (
    contract_id bigint NOT NULL,
    slot_ordinal bigint NOT NULL,
    end_ns bigint NOT NULL,
    start_ns bigint,
    open bigint,
    high bigint,
    low bigint,
    close bigint,
    high_at_ns bigint,
    low_at_ns bigint,
    vwap double precision,
    rsi double precision,
    atr_bps double precision,
    ret_atr double precision,
    close_loc double precision,
    vwap_atr double precision,
    delta_ratio double precision,
    rel_volume double precision,
    complete double precision,
    range_bps double precision,
    body_bps double precision,
    body_ratio double precision,
    upper_wick_ratio double precision,
    lower_wick_ratio double precision,
    vwap_bps double precision,
    active_ratio double precision,
    path_bps double precision,
    path_efficiency double precision,
    uptick_ratio double precision,
    known_ratio double precision,
    count_delta_ratio double precision,
    cvd_high_ratio double precision,
    cvd_low_ratio double precision,
    size_hhi double precision,
    max_size_ratio double precision,
    side_switch_ratio double precision,
    size_side_ratio double precision,
    sweep_ratio double precision,
    sweep_delta_ratio double precision,
    spread_bps double precision,
    spread_max_bps double precision,
    eff_spread_bps double precision,
    imbalance_mean double precision,
    imbalance_vw double precision,
    depth_imbalance double precision,
    tilt_bps double precision,
    alignment double precision,
    take_ratio double precision,
    order_imbalance double precision,
    order_size_log_ratio double precision,
    quote_ratio double precision,
    bad_book_ratio double precision,
    trade_age_s double precision,
    book_age_s double precision,
    depth_age_s double precision,
    book_spread_bps double precision,
    book_imbalance double precision,
    session_elapsed_s double precision,
    session_ret_bps double precision,
    session_high_bps double precision,
    session_low_bps double precision,
    session_delta_ratio double precision,
    ema9_atr double precision,
    ema21_atr double precision,
    ema50_atr double precision,
    macd_atr double precision,
    macd_signal_atr double precision,
    macd_hist_atr double precision,
    ppo_bps double precision,
    adx double precision,
    plus_di double precision,
    minus_di double precision,
    mid_rsi double precision,
    rel_trades double precision,
    rel_depth double precision,
    rel_spread double precision,
    stoch_k double precision,
    stoch_d double precision,
    bb_z double precision,
    bb_width_bps double precision,
    cci double precision,
    donchian_pos double precision,
    donchian_high_atr double precision,
    donchian_low_atr double precision,
    aroon_up double precision,
    aroon_down double precision,
    linreg_slope_atr double precision,
    linreg_r2 double precision,
    chop double precision,
    vol_bps double precision,
    cmf double precision,
    mfi double precision,
    er double precision,
    ret_5_atr double precision,
    ret_15_atr double precision,
    delta_ratio_5 double precision,
    delta_ratio_15 double precision,
    flow_price_corr double precision,
    volume integer,
    buy_volume integer,
    sell_volume integer,
    trades integer,
    delta_high integer,
    delta_low integer,
    status smallint NOT NULL,
    observed smallint,
    phase smallint GENERATED ALWAYS AS ((slot_ordinal % 60)::smallint) VIRTUAL,
    PRIMARY KEY (contract_id, slot_ordinal, end_ns)
) PARTITION BY RANGE (end_ns);
CREATE INDEX candle_1m_1s_end ON market.candle_1m_1s USING brin (end_ns);

-- One continuous series per product: each session's rows come from that session's front
-- contract (market.roll), so 'GC' reads as one series across contract rolls. Rows stay
-- stored per contract; delivery months are never merged, because their prices differ.
-- Contracts of a product share the calendar, so slot_ordinal continues across rolls with one
-- row per scheduled-open second. Each row's features come from its own contract's history
-- (warmed by lead sessions), so a roll adds no artificial move to them; raw prices jump by
-- the difference between the months, flagged by `rolled`. The views select table.*, fixed at
-- creation: recreate them in any migration that adds columns to the tables.

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
