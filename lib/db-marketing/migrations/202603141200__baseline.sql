CREATE TABLE public.user_v1 (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username text NOT NULL,
    email text,
    phone integer,
    time_created timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    time_modified timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_v1_username_key UNIQUE (username)
);

CREATE TABLE public.user_note_v1 (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id integer NOT NULL,
    title text,
    summary text,
    description text,
    time_due timestamp with time zone NOT NULL,
    time_remind timestamp with time zone NOT NULL,
    time_created timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    time_modified timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_note_v1_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.user_v1(id) ON DELETE CASCADE
);

CREATE INDEX user_note_v1_user_id_idx
  ON public.user_note_v1 (user_id);
