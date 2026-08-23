--
-- PostgreSQL database dump
--

\restrict gZXGZSbehXMrrHNPcJHtbTLP8tUxmlclXfiuGJm2NcnZXhjj8UaAZP3oD9wfdGs

-- Dumped from database version 15.18 (Homebrew)
-- Dumped by pg_dump version 15.18 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: mailing_list_records; Type: TABLE DATA; Schema: public; Owner: agentorange
--

COPY public.mailing_list_records (id, first_name, last_name, spouse_first_name, spouse_last_name, company_name, property_address, property_city, property_state, property_zip, property_county, acres, apn, offer_price, offer_per_acre, mailing_salutation, mailing_address, mailing_city, mailing_state, mailing_zip, do_not_mail, bad_address, created_at, updated_at) FROM stdin;
\.


--
-- Name: mailing_list_records_id_seq; Type: SEQUENCE SET; Schema: public; Owner: agentorange
--

SELECT pg_catalog.setval('public.mailing_list_records_id_seq', 1, false);


--
-- PostgreSQL database dump complete
--

\unrestrict gZXGZSbehXMrrHNPcJHtbTLP8tUxmlclXfiuGJm2NcnZXhjj8UaAZP3oD9wfdGs

