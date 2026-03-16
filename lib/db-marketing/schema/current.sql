--
-- PostgreSQL database dump
--


-- Dumped from database version 17.9 (Debian 17.9-1.pgdg13+1)
-- Dumped by pg_dump version 18.2

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--



--
-- Name: apply_row_timestamps_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_row_timestamps_v1() RETURNS trigger
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


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: user_note_v1; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_note_v1 (
    id integer NOT NULL,
    user_id integer NOT NULL,
    title text,
    summary text,
    description text,
    time_due timestamp with time zone NOT NULL,
    time_remind timestamp with time zone NOT NULL,
    time_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    time_modified timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    title_embedding public.vector(1536),
    content_embedding public.vector(1536),
    embedding_model text,
    embedding_updated_at timestamp with time zone
);


--
-- Name: user_note_v1_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.user_note_v1 ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.user_note_v1_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: user_v1; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_v1 (
    id integer NOT NULL,
    username text NOT NULL,
    email text,
    phone text,
    time_created timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    time_modified timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: user_v1_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.user_v1 ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.user_v1_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: user_note_v1 user_note_v1_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_v1
    ADD CONSTRAINT user_note_v1_pkey PRIMARY KEY (id);


--
-- Name: user_v1 user_v1_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_v1
    ADD CONSTRAINT user_v1_pkey PRIMARY KEY (id);


--
-- Name: user_v1 user_v1_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_v1
    ADD CONSTRAINT user_v1_username_key UNIQUE (username);


--
-- Name: user_note_v1_content_embedding_hnsw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_note_v1_content_embedding_hnsw_idx ON public.user_note_v1 USING hnsw (content_embedding public.vector_cosine_ops);


--
-- Name: user_note_v1_title_embedding_hnsw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_note_v1_title_embedding_hnsw_idx ON public.user_note_v1 USING hnsw (title_embedding public.vector_cosine_ops);


--
-- Name: user_note_v1_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_note_v1_user_id_idx ON public.user_note_v1 USING btree (user_id);


--
-- Name: user_note_v1 user_note_v1_apply_row_timestamps_v1; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_note_v1_apply_row_timestamps_v1 BEFORE INSERT OR UPDATE ON public.user_note_v1 FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();


--
-- Name: user_v1 user_v1_apply_row_timestamps_v1; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER user_v1_apply_row_timestamps_v1 BEFORE INSERT OR UPDATE ON public.user_v1 FOR EACH ROW EXECUTE FUNCTION public.apply_row_timestamps_v1();


--
-- Name: user_note_v1 user_note_v1_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_note_v1
    ADD CONSTRAINT user_note_v1_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_v1(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


