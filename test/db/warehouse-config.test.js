// Unitaria, sin DB. Cubre un gap de configuración documentado en
// docs/TECH_DEBT_UNREPRODUCIBLE_TABLES.md: processed.fieldbeat_report_fields
// tiene generador CSV real (data/processed/fieldbeat/DB_FieldBeat_Report_Fields.csv)
// y ya existe en el DDL autogenerado de Postgres (sql/010_processed.sql),
// pero faltaba en TABLES -sin esa entrada, ownership-manifest.js la
// clasifica EXTERNAL y migrate-to-supabase.js nunca la sincroniza, aunque
// src/working-hours/db-writer.js (loadReferenceData) y
// src/working-hours/build-working-hours.js (parity) SÍ la consultan contra
// Postgres real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TABLES } from "../../src/db/warehouse-config.js";

test("TABLES incluye processed.fieldbeat_report_fields con su CSV fuente real", () => {
  const entry = TABLES.find(t => t.schema === "processed" && t.table === "fieldbeat_report_fields");
  assert.ok(entry, "falta la entrada de fieldbeat_report_fields en TABLES -sin ella migrate-to-supabase.js la trata como EXTERNAL y nunca la sincroniza");
  assert.equal(entry.csv, "data/processed/fieldbeat/DB_FieldBeat_Report_Fields.csv");
});
