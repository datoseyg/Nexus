-- Fase 1 de la migración Nexus a Supabase Postgres.
-- Se corre una sola vez (o de nuevo, es idempotente) vía el SQL editor de
-- Supabase o psql, contra la conexión DIRECTA (puerto 5432) -no el pooler.
-- Orden de ejecución de sql/: 000 -> 005 -> 010 -> 020 -> 030 -> 040 -> 050 -> 060.

-- pgcrypto -digest()/hmac()/crypt() (usados por las funciones de governance,
-- ver sql/090 en adelante). gen_random_uuid() NO depende de esto -viene en
-- core desde Postgres 13. Supabase instala pgcrypto en el schema
-- `extensions` por defecto (nunca `public`, confirmado vía el dump de
-- proyectos Supabase reales) - se replica esa misma ubicación acá para que
-- toda referencia calificada (extensions.digest(...), etc.) resuelva igual
-- en Supabase y en cualquier Postgres vanilla (ej. el desechable local de
-- tests), sin depender de resolución implícita por search_path.
CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    -- Nunca instalada en esta base -crear directo en el schema canónico.
    CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
  ELSIF (SELECT extnamespace::regnamespace::text FROM pg_extension WHERE extname = 'pgcrypto') <> 'extensions' THEN
    -- Ya instalada en otro schema (ej. una base donde una versión anterior
    -- de este archivo la instaló en `public`) - relocalizar explícitamente.
    -- pgcrypto es relocatable; esto nunca toca ni mueve ninguna otra
    -- extensión, y es un no-op si ya está en `extensions` (caso Supabase).
    ALTER EXTENSION pgcrypto SET SCHEMA extensions;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS processed;
CREATE SCHEMA IF NOT EXISTS marts;
CREATE SCHEMA IF NOT EXISTS gold;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS manual_review;
CREATE SCHEMA IF NOT EXISTS stock;

-- Postgres no tiene "CREATE ROLE IF NOT EXISTS" -se emula con un bloque DO.
-- La contraseña NUNCA se hardcodea acá: el placeholder se reemplaza a mano
-- en el SQL editor de Supabase (o se rota con ALTER ROLE ... PASSWORD
-- después de correr esto) ANTES de armar SUPABASE_DB_URL -este archivo
-- versionado nunca contiene la contraseña real, ni siquiera temporalmente.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'nexus_app') THEN
    CREATE ROLE nexus_app WITH LOGIN PASSWORD '__SET_IN_SUPABASE_DASHBOARD__';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA raw, processed, marts, gold, audit, manual_review, stock TO nexus_app;

-- Solo lectura en las capas medallion
GRANT SELECT ON ALL TABLES IN SCHEMA raw, processed, marts, gold TO nexus_app;

-- Lectura+escritura en las capas transaccionales
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA audit, manual_review, stock TO nexus_app;

-- bigserial/identity de las tablas transaccionales necesitan esto aparte
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA audit, manual_review, stock TO nexus_app;

-- ALTER DEFAULT PRIVILEGES sin "FOR ROLE x" solo aplica a objetos creados
-- por QUIEN EJECUTA este ALTER -no a todas las tablas futuras sin importar
-- quién las cree. sql/010-030 (autogenerado) y las re-corridas de
-- generate-postgres-ddl.js se ejecutan vía el SQL editor de Supabase, que
-- corre como el rol `postgres` por default -por eso el FOR ROLE explícito.
-- Si en algún proyecto el SQL editor corre como otro rol, ajustar acá.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA raw, processed, marts, gold
  GRANT SELECT ON TABLES TO nexus_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA audit, manual_review, stock
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nexus_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA audit, manual_review, stock
  GRANT USAGE, SELECT ON SEQUENCES TO nexus_app;
