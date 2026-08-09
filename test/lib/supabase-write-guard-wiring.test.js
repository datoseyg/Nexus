// NEXUS V3 - prueba que CADA write path hacia Supabase realmente delega en
// la política única (src/lib/db-safety.js::assertSupabaseWriteAuthorized),
// no solo que la política en sí funcione (eso ya lo cubre
// test/lib/db-safety.test.js). Sin DB, sin red, sin archivos reales -en
// todos los casos el guard debe rechazar ANTES de cualquier I/O real, así
// que un `file`/`coverageId` inexistente nunca debería importar: si algún
// caller alguna vez reordena su propio guard después de una lectura real,
// este test empieza a fallar con un error de archivo/DB en vez del error de
// guard esperado, delatando la regresión.
import { test } from "node:test";
import assert from "node:assert/strict";
import { UnknownSupabaseProjectError, WriteConfirmationRequiredError } from "../../src/lib/db-safety.js";
import { migrateToSupabase } from "../../src/db/migrate-to-supabase.js";
import { applyContracts } from "../../src/contracts/db-writer.js";
import { runCli as runHolidaysCli } from "../../src/holidays/import-holidays.js";
import { runApply as runWorkingHoursApply } from "../../src/working-hours/build-working-hours.js";
import { prepareAndAuthorizeWorkingHoursWrite } from "../../scripts/pipeline/run-data-refresh.mjs";

const V3_HOST = "db.v3projectref.supabase.co";
const V3_URL = `postgresql://u:p@${V3_HOST}:5432/postgres`;
const V3_TOKEN = `${V3_HOST}:5432/postgres`;

const GUARD_ENV_VARS = [
  "SUPABASE_DB_URL_DIRECT",
  "WORKING_HOURS_DB_URL",
  "HOLIDAYS_DB_URL",
  "CONFIRM_WRITE_TARGET",
  "CONFIRM_PROTECTED_WRITE_TARGET",
  "SUPABASE_PROJECT_REF_V3"
];

function clearGuardEnv() {
  for (const name of GUARD_ENV_VARS) delete process.env[name];
}

// === A: src/db/migrate-to-supabase.js -entrypoint manual ===

test("migrateToSupabase() sin argumentos (como `npm run db:pg:migrate`): AMBAS confirmaciones exactas pero SUPABASE_PROJECT_REF_V3 ausente -> rechazado (UnknownSupabaseProjectError). Antes de este cambio, la invocación sin argumentos se saltaba por completo el chequeo de project ref.", async () => {
  clearGuardEnv();
  process.env.SUPABASE_DB_URL_DIRECT = V3_URL;
  process.env.CONFIRM_WRITE_TARGET = V3_TOKEN;
  process.env.CONFIRM_PROTECTED_WRITE_TARGET = V3_TOKEN;
  await assert.rejects(() => migrateToSupabase(), UnknownSupabaseProjectError);
  clearGuardEnv();
});

test("migrateToSupabase() sin argumentos: sin ninguna confirmación -> rechazado (WriteConfirmationRequiredError) antes de tocar DuckDB", async () => {
  clearGuardEnv();
  process.env.SUPABASE_DB_URL_DIRECT = V3_URL;
  await assert.rejects(() => migrateToSupabase(), WriteConfirmationRequiredError);
  clearGuardEnv();
});

// === B: src/contracts/db-writer.js ===

test("applyContracts(): project ref equivocado -> rechazado antes de intentar leer el CSV (archivo inexistente a propósito)", async () => {
  clearGuardEnv();
  process.env.SUPABASE_DB_URL_DIRECT = V3_URL;
  process.env.CONFIRM_WRITE_TARGET = V3_TOKEN;
  process.env.CONFIRM_PROTECTED_WRITE_TARGET = V3_TOKEN;
  process.env.SUPABASE_PROJECT_REF_V3 = "otro-proyecto-distinto";
  await assert.rejects(
    () => applyContracts({ file: "no-existe.csv", effectiveDate: "2026-01-01" }),
    UnknownSupabaseProjectError
  );
  clearGuardEnv();
});

test("applyContracts(): sin ninguna confirmación -> rechazado antes de intentar leer el CSV (archivo inexistente a propósito)", async () => {
  clearGuardEnv();
  process.env.SUPABASE_DB_URL_DIRECT = V3_URL;
  await assert.rejects(
    () => applyContracts({ file: "no-existe.csv", effectiveDate: "2026-01-01" }),
    WriteConfirmationRequiredError
  );
  clearGuardEnv();
});

// === B: src/holidays/import-holidays.js (vía runCli -runApply/runPublish no
// se exportan individualmente; "publish" no requiere leer ningún bundle,
// así que prueba el guard sin necesitar un archivo real) ===

test("holidays runCli(['publish', ...]): project ref equivocado -> rechazado antes de tocar la DB", async () => {
  clearGuardEnv();
  process.env.HOLIDAYS_DB_URL = V3_URL;
  process.env.CONFIRM_WRITE_TARGET = V3_TOKEN;
  process.env.CONFIRM_PROTECTED_WRITE_TARGET = V3_TOKEN;
  process.env.SUPABASE_PROJECT_REF_V3 = "otro-proyecto-distinto";
  await assert.rejects(
    () => runHolidaysCli(["publish", "--coverage-id=1"]),
    UnknownSupabaseProjectError
  );
  clearGuardEnv();
});

test("holidays runCli(['publish', ...]): sin ninguna confirmación -> rechazado antes de tocar la DB", async () => {
  clearGuardEnv();
  process.env.HOLIDAYS_DB_URL = V3_URL;
  await assert.rejects(
    () => runHolidaysCli(["publish", "--coverage-id=1"]),
    WriteConfirmationRequiredError
  );
  clearGuardEnv();
});

// === B: src/working-hours/build-working-hours.js ===

test("working-hours runApply(): project ref equivocado -> rechazado antes de construir el pool", async () => {
  clearGuardEnv();
  process.env.WORKING_HOURS_DB_URL = V3_URL;
  process.env.CONFIRM_WRITE_TARGET = V3_TOKEN;
  process.env.CONFIRM_PROTECTED_WRITE_TARGET = V3_TOKEN;
  process.env.SUPABASE_PROJECT_REF_V3 = "otro-proyecto-distinto";
  await assert.rejects(() => runWorkingHoursApply({ from: null, to: null }), UnknownSupabaseProjectError);
  clearGuardEnv();
});

test("working-hours runApply(): sin ninguna confirmación -> rechazado antes de construir el pool (antes: bloqueo incondicional por host, ahora: misma política única)", async () => {
  clearGuardEnv();
  process.env.WORKING_HOURS_DB_URL = V3_URL;
  await assert.rejects(() => runWorkingHoursApply({ from: null, to: null }), WriteConfirmationRequiredError);
  clearGuardEnv();
});

// === C: scripts/pipeline/run-data-refresh.mjs -preflight del contract-rematch,
// extraído como prepareAndAuthorizeWorkingHoursWrite() precisamente para
// poder probarlo aislado, sin DB (antes: el pg.Pool del rematch se abría
// directo, sin pasar por ningún guard) ===

test("prepareAndAuthorizeWorkingHoursWrite(): project ref equivocado -> rechazado (protege el contract-rematch, que antes no tenía ningún guard)", () => {
  clearGuardEnv();
  process.env.SUPABASE_PROJECT_REF_V3 = "otro-proyecto-distinto";
  // No se pre-cargan tokens de confirmación -prepareAndAuthorizeWorkingHoursWrite
  // los calcula ella misma a partir de workingHoursDbUrl (igual que
  // prepareSupabaseWriteConfirmation para SUPABASE_DB_URL_DIRECT), así que
  // CONFIRM_WRITE_TARGET/CONFIRM_PROTECTED_WRITE_TARGET SIEMPRE coinciden
  // con el destino -el único chequeo real que puede fallar acá es el de
  // project ref, exactamente lo que este test aísla.
  assert.throws(() => prepareAndAuthorizeWorkingHoursWrite(V3_URL), UnknownSupabaseProjectError);
  clearGuardEnv();
});

test("prepareAndAuthorizeWorkingHoursWrite(): SUPABASE_PROJECT_REF_V3 ausente -> rechazado, nunca asume por defecto", () => {
  clearGuardEnv();
  assert.throws(() => prepareAndAuthorizeWorkingHoursWrite(V3_URL), UnknownSupabaseProjectError);
  clearGuardEnv();
});

test("prepareAndAuthorizeWorkingHoursWrite(): project ref correcto -> permitido (fija sus propios tokens de confirmación y pasa el chequeo de identidad V3)", () => {
  clearGuardEnv();
  process.env.SUPABASE_PROJECT_REF_V3 = "v3projectref";
  assert.doesNotThrow(() => prepareAndAuthorizeWorkingHoursWrite(V3_URL));
  clearGuardEnv();
});

test("prepareAndAuthorizeWorkingHoursWrite(): target local -> sigue las reglas locales existentes, nunca exige SUPABASE_PROJECT_REF_V3", () => {
  clearGuardEnv();
  assert.doesNotThrow(() => prepareAndAuthorizeWorkingHoursWrite("postgresql://u:p@localhost:55480/nexus_bi_dev_local_test"));
});
