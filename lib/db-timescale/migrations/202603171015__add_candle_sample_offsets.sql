ALTER TABLE public.candles_1m_1s
    ADD COLUMN IF NOT EXISTS second smallint;

UPDATE public.candles_1m_1s
SET second = EXTRACT(SECOND FROM "time" AT TIME ZONE 'UTC')::smallint
WHERE second IS NULL;

ALTER TABLE public.candles_1m_1s
    ADD CONSTRAINT candles_1m_1s_second_range CHECK (second BETWEEN 0 AND 59),
    ALTER COLUMN second SET NOT NULL;

ALTER TABLE public.candles_1h_1m
    ADD COLUMN IF NOT EXISTS minute smallint;

UPDATE public.candles_1h_1m
SET minute = EXTRACT(MINUTE FROM "time" AT TIME ZONE 'UTC')::smallint
WHERE minute IS NULL;

ALTER TABLE public.candles_1h_1m
    ADD CONSTRAINT candles_1h_1m_minute_range CHECK (minute BETWEEN 0 AND 59),
    ALTER COLUMN minute SET NOT NULL;
