-- Schema manual_review: tablas transaccionales para el "Centro de
-- Correcciones" (hoy FutureActionButton.tsx, deshabilitado — no se conecta
-- en esta migración, ver docs/RUNBOOK_SUPABASE_NETLIFY.md y el plan de
-- migración § Fase 5 sobre por qué el wiring de UI queda bloqueado hasta
-- que exista autenticación real).
--
-- Alineado con data/curation/*.example.csv de la rama cloud-d1-readonly
-- (revisado antes de escribir esto, para no inventar un modelo paralelo
-- incompatible con el ya diseñado ahí).

-- Alineado con data/curation/part_identity_aliases.example.csv:
-- alias_value, alias_type, dolibarr_product_id, dolibarr_ref, reason,
-- created_by, created_at — mismas columnas, más id/updated_at/active
-- porque acá es una tabla relacional real, no un CSV plano.
CREATE TABLE IF NOT EXISTS manual_review.part_aliases (
  id bigserial PRIMARY KEY,
  alias_value text NOT NULL,
  alias_type text NOT NULL CHECK (alias_type IN ('RAW','NORMALIZED')),
  dolibarr_product_id bigint NOT NULL,
  dolibarr_ref text,
  reason text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (alias_value, alias_type)
);

-- Alineado con data/curation/ticket_link_overrides.example.csv — modelo de
-- RESULTADO de la corrección, no de cola de revisión: corrected_* queda
-- NULL cuando override_type es CONFIRMED_NO_TICKET (se confirma que esa
-- visita nunca generó ticket real).
CREATE TABLE IF NOT EXISTS manual_review.ticket_link_overrides (
  id bigserial PRIMARY KEY,
  fieldbeat_task_id bigint NOT NULL,
  raw_linked_zendesk_ticket_id text,
  corrected_zendesk_ticket_id bigint,
  override_type text NOT NULL CHECK (override_type IN ('CONFIRMED_NO_TICKET','CORRECTED','DUPLICATE')),
  reason text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT corrected_ticket_required_unless_no_ticket
    CHECK (override_type = 'CONFIRMED_NO_TICKET' OR corrected_zendesk_ticket_id IS NOT NULL),
  UNIQUE (fieldbeat_task_id)
);
