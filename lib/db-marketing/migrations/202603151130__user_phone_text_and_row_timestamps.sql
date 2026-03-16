ALTER TABLE public.user_v1
  ALTER COLUMN phone TYPE text
  USING phone::text;

CREATE OR REPLACE FUNCTION public.apply_row_timestamps_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.time_created := COALESCE(NEW.time_created, CURRENT_TIMESTAMP);
  ELSE
    NEW.time_created := OLD.time_created;
  END IF;

  NEW.time_modified := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_v1_apply_row_timestamps_v1 ON public.user_v1;
CREATE TRIGGER user_v1_apply_row_timestamps_v1
BEFORE INSERT OR UPDATE ON public.user_v1
FOR EACH ROW
EXECUTE FUNCTION public.apply_row_timestamps_v1();

DROP TRIGGER IF EXISTS user_note_v1_apply_row_timestamps_v1 ON public.user_note_v1;
CREATE TRIGGER user_note_v1_apply_row_timestamps_v1
BEFORE INSERT OR UPDATE ON public.user_note_v1
FOR EACH ROW
EXECUTE FUNCTION public.apply_row_timestamps_v1();
