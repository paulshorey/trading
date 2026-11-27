-- Immutable editions of the same local calendars used by the engine and the dataset.
CREATE TABLE market.clock_rule (
    revision text NOT NULL,
    event text NOT NULL,
    products text[] NOT NULL,
    venue text NOT NULL,
    source_zone text NOT NULL,
    normal_local_time time,
    calendar text NOT NULL,
    anchor text NOT NULL,
    source text NOT NULL,
    valid_from date NOT NULL,
    valid_through date NOT NULL CHECK (valid_through >= valid_from),
    tzdata_version text NOT NULL,
    PRIMARY KEY (revision, event, valid_from)
);

CREATE TABLE market.clock_occurrence (
    revision text NOT NULL,
    product text NOT NULL,
    event text NOT NULL,
    rule_valid_from date NOT NULL,
    venue_trade_date date NOT NULL,
    source_local_date date NOT NULL,
    source_local_time time NOT NULL,
    scheduled_at timestamptz NOT NULL,
    known_at timestamptz,
    source text NOT NULL,
    PRIMARY KEY (revision, product, event, venue_trade_date, scheduled_at),
    FOREIGN KEY (revision, event, rule_valid_from) REFERENCES market.clock_rule
);
CREATE INDEX clock_occurrence_time ON market.clock_occurrence (revision, product, scheduled_at);
