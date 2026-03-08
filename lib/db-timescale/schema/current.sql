--
-- PostgreSQL database dump
--

\restrict uaAOcJ3xUyljp8sKxVUFMyjqhAFmOABa0ORdZTg25ri5pQdmeqHHVy1Ox1JGfvS

-- Dumped from database version 17.7
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

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: candles-1m; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."candles-1m" (
    "time" timestamp with time zone NOT NULL,
    ticker text NOT NULL,
    open double precision NOT NULL,
    high double precision NOT NULL,
    low double precision NOT NULL,
    close double precision NOT NULL,
    volume double precision NOT NULL,
    symbol text,
    vd double precision,
    cvd_open double precision,
    cvd_high double precision,
    cvd_low double precision,
    cvd_close double precision,
    vd_ratio double precision,
    book_imbalance double precision,
    price_pct double precision,
    trades integer,
    max_trade_size integer,
    big_trades integer,
    big_volume bigint,
    divergence smallint
);


--
-- Name: bbo-1s; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."bbo-1s" (
    "time" timestamp with time zone NOT NULL,
    ticker text NOT NULL,
    open numeric,
    high numeric,
    low numeric,
    close numeric,
    volume numeric,
    cvd numeric
);


--
-- Name: candles_1m_1s; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candles_1m_1s (
    "time" timestamp with time zone NOT NULL,
    ticker text NOT NULL,
    open double precision NOT NULL,
    high double precision NOT NULL,
    low double precision NOT NULL,
    close double precision NOT NULL,
    volume double precision DEFAULT 0 NOT NULL,
    ask_volume double precision DEFAULT 0 NOT NULL,
    bid_volume double precision DEFAULT 0 NOT NULL,
    cvd_open double precision,
    cvd_high double precision,
    cvd_low double precision,
    cvd_close double precision,
    vd double precision,
    trades integer DEFAULT 0,
    max_trade_size double precision DEFAULT 0,
    big_trades integer DEFAULT 0,
    big_volume double precision DEFAULT 0,
    symbol text,
    vd_ratio double precision,
    book_imbalance double precision,
    price_pct double precision,
    divergence double precision,
    sum_bid_depth double precision DEFAULT 0,
    sum_ask_depth double precision DEFAULT 0,
    sum_price_volume double precision DEFAULT 0,
    unknown_volume double precision DEFAULT 0,
    vwap double precision
);


--
-- Name: candles_1h_1m; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candles_1h_1m (
    "time" timestamp with time zone NOT NULL,
    ticker text NOT NULL,
    symbol text,
    open double precision NOT NULL,
    high double precision NOT NULL,
    low double precision NOT NULL,
    close double precision NOT NULL,
    volume double precision DEFAULT 0 NOT NULL,
    ask_volume double precision DEFAULT 0 NOT NULL,
    bid_volume double precision DEFAULT 0 NOT NULL,
    cvd_open double precision,
    cvd_high double precision,
    cvd_low double precision,
    cvd_close double precision,
    vd double precision,
    vd_ratio double precision,
    book_imbalance double precision,
    price_pct double precision,
    divergence double precision,
    trades integer DEFAULT 0,
    max_trade_size double precision DEFAULT 0,
    big_trades integer DEFAULT 0,
    big_volume double precision DEFAULT 0,
    sum_bid_depth double precision DEFAULT 0,
    sum_ask_depth double precision DEFAULT 0,
    sum_price_volume double precision DEFAULT 0,
    unknown_volume double precision DEFAULT 0
);


--
-- Name: candles_1s; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candles_1s (
    "time" timestamp with time zone NOT NULL,
    ticker text NOT NULL,
    symbol text,
    open double precision NOT NULL,
    high double precision NOT NULL,
    low double precision NOT NULL,
    close double precision NOT NULL,
    volume double precision NOT NULL,
    cvd_open double precision,
    cvd_high double precision,
    cvd_low double precision,
    cvd_close double precision,
    vd double precision,
    vd_ratio double precision,
    book_imbalance double precision,
    price_pct double precision,
    trades integer,
    max_trade_size double precision,
    big_trades integer,
    big_volume double precision,
    divergence smallint,
    ask_volume double precision,
    bid_volume double precision,
    sum_bid_depth double precision DEFAULT 0,
    sum_ask_depth double precision DEFAULT 0,
    sum_price_volume double precision DEFAULT 0,
    unknown_volume double precision DEFAULT 0,
    vwap double precision
);


--
-- Name: bbo-1s bbo-1s_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."bbo-1s"
    ADD CONSTRAINT "bbo-1s_pkey" PRIMARY KEY ("time", ticker);


--
-- Name: candles-1m candles-1m_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."candles-1m"
    ADD CONSTRAINT "candles-1m_pkey" PRIMARY KEY (ticker, "time");


--
-- Name: candles_1s candles-1s_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candles_1s
    ADD CONSTRAINT "candles-1s_pkey" PRIMARY KEY (ticker, "time");


--
-- Name: candles_1m_1s candles_1m_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candles_1m_1s
    ADD CONSTRAINT candles_1m_pkey PRIMARY KEY (ticker, "time");


--
-- Name: candles_1h_1m candles_1h_1m_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candles_1h_1m
    ADD CONSTRAINT candles_1h_1m_pkey PRIMARY KEY (ticker, "time");


--
-- Name: candles-1m_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "candles-1m_time_idx" ON public."candles-1m" USING btree ("time" DESC);


--
-- Name: candles_1h_1m_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX candles_1h_1m_time_idx ON public.candles_1h_1m USING btree ("time" DESC);


--
-- Name: candles_1s_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX candles_1s_time_idx ON public.candles_1s USING btree ("time" DESC);


--
-- Name: idx_bbo_1s_ticker; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bbo_1s_ticker ON public."bbo-1s" USING btree (ticker);


--
-- Name: idx_bbo_1s_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bbo_1s_time ON public."bbo-1s" USING btree ("time");


--
-- Name: idx_candles_1m_divergence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candles_1m_divergence ON public."candles-1m" USING btree (ticker, "time" DESC) WHERE (divergence <> 0);


--
-- Name: idx_candles_1s_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candles_1s_time ON public.candles_1s USING btree ("time" DESC);


--
-- Name: idx_dow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dow ON public."candles-1m" USING btree (EXTRACT(dow FROM ("time" AT TIME ZONE 'UTC'::text)));


--
-- Name: idx_hour; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hour ON public."candles-1m" USING btree (EXTRACT(hour FROM ("time" AT TIME ZONE 'UTC'::text)));


--
-- Name: idx_minute; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_minute ON public."candles-1m" USING btree (EXTRACT(minute FROM ("time" AT TIME ZONE 'UTC'::text)));


--
-- PostgreSQL database dump complete
--

\unrestrict uaAOcJ3xUyljp8sKxVUFMyjqhAFmOABa0ORdZTg25ri5pQdmeqHHVy1Ox1JGfvS

