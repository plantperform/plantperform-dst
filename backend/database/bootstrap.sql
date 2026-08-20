-- One-time bootstrap of the PlantPerform application database on a fresh
-- PostgreSQL or PostGIS server.
--
-- Run as an administrator against the default "postgres" database:
--
--   psql "postgresql://<ADMIN_USER>:<ADMIN_PASSWORD>@<host>:5432/postgres" \
--        -v app_password="'<APP_PASSWORD>'" \
--        -f backend/database/bootstrap.sql
--
-- The :'app_password' placeholder is supplied via psql's -v flag so the
-- password is not stored in source control.

\set ON_ERROR_STOP on

CREATE DATABASE dst2;

CREATE ROLE dst2_app WITH LOGIN PASSWORD :app_password;

GRANT CONNECT ON DATABASE dst2 TO dst2_app;

\c dst2

GRANT USAGE, CREATE ON SCHEMA public TO dst2_app;

CREATE EXTENSION IF NOT EXISTS postgis;
