CREATE OR REPLACE FUNCTION public.sync_candles_1m_1s_second()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.second := EXTRACT(SECOND FROM NEW."time" AT TIME ZONE 'UTC')::smallint;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS candles_1m_1s_sync_second ON public.candles_1m_1s;

CREATE TRIGGER candles_1m_1s_sync_second
BEFORE INSERT OR UPDATE ON public.candles_1m_1s
FOR EACH ROW
EXECUTE FUNCTION public.sync_candles_1m_1s_second();

CREATE OR REPLACE FUNCTION public.sync_candles_1h_1m_minute()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.minute := EXTRACT(MINUTE FROM NEW."time" AT TIME ZONE 'UTC')::smallint;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS candles_1h_1m_sync_minute ON public.candles_1h_1m;

CREATE TRIGGER candles_1h_1m_sync_minute
BEFORE INSERT OR UPDATE ON public.candles_1h_1m
FOR EACH ROW
EXECUTE FUNCTION public.sync_candles_1h_1m_minute();
