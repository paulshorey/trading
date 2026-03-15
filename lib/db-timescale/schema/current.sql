--
-- PostgreSQL database dump
--


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



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--



SET default_tablespace = '';

SET default_table_access_method = heap;

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
    trades integer DEFAULT 0 NOT NULL,
    max_trade_size double precision DEFAULT 0 NOT NULL,
    big_trades integer DEFAULT 0 NOT NULL,
    big_volume double precision DEFAULT 0 NOT NULL,
    sum_bid_depth double precision DEFAULT 0 NOT NULL,
    sum_ask_depth double precision DEFAULT 0 NOT NULL,
    sum_price_volume double precision DEFAULT 0 NOT NULL,
    unknown_volume double precision DEFAULT 0 NOT NULL
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
    trades integer DEFAULT 0 NOT NULL,
    max_trade_size double precision DEFAULT 0 NOT NULL,
    big_trades integer DEFAULT 0 NOT NULL,
    big_volume double precision DEFAULT 0 NOT NULL,
    symbol text,
    vd_ratio double precision,
    book_imbalance double precision,
    price_pct double precision,
    divergence double precision,
    sum_bid_depth double precision DEFAULT 0 NOT NULL,
    sum_ask_depth double precision DEFAULT 0 NOT NULL,
    sum_price_volume double precision DEFAULT 0 NOT NULL,
    unknown_volume double precision DEFAULT 0 NOT NULL
);


--
-- Name: candles_1h_1m candles_1h_1m_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candles_1h_1m
    ADD CONSTRAINT candles_1h_1m_pkey PRIMARY KEY (ticker, "time");


--
-- Name: candles_1m_1s candles_1m_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candles_1m_1s
    ADD CONSTRAINT candles_1m_pkey PRIMARY KEY (ticker, "time");


--
-- Name: idx_candles_1h_1m_time_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candles_1h_1m_time_desc ON public.candles_1h_1m USING btree ("time" DESC);


--
-- Name: idx_candles_1m_1s_time_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candles_1m_1s_time_desc ON public.candles_1m_1s USING btree ("time" DESC);


--
-- PostgreSQL database dump complete
--
