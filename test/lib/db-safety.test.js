// ETAPA SAFETY-1 - Tests puros (sin DB real) para la lógica de decisión del
// guard de aislamiento. Reproduce primero el incidente (7.1-7.4: el guard
// actual NO existía, cualquier target era aceptado), luego prueba los 7
// casos A-G exigidos.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateDisposableTarget,
  PROTECTED_DATABASE_NAMES,
  describeConnectionTarget,
  isLikelyDisposableName,
  isSupabaseCloudHost,
  assertWriteConfirmed,
  WriteConfirmationRequiredError,
  parseSupabaseProjectRef,
  assertKnownSupabaseProject,
  UnknownSupabaseProjectError
} from "../../src/lib/db-safety.js";

const BASE_VALID = {
  databaseComment: "DISPOSABLE_TEST:run-abc123",
  expectedRunId: "run-abc123",
  currentUser: "integration_test",
  expectedUser: "integration_test",
  databaseName: "nexus_wh_ddl_test_20260718",
  protectedDatabaseNames: PROTECTED_DATABASE_NAMES,
  applicationName: "working-hours-ddl-test:run-abc123",
  expectedSuiteId: "working-hours-ddl-test"
};

// === §7.1-7.4 - reproducción del estado ANTES del fix (documenta el hueco real) ===

test("7.1 REPRODUCCIÓN: el guard viejo ({skip: !TEST_DB_URL}) acepta CUALQUIER string no vacío, incluida una URL real de revisión", () => {
  const oldGuardAccepts = (testDbUrl) => !!testDbUrl; // literalmente el patrón replicado en los 5 archivos
  assert.equal(oldGuardAccepts("postgresql://postgres:localtest@localhost:15451/nexus_afterhours_realdata"), true, "el guard viejo NO distingue un target de revisión de uno desechable -exactamente lo que causó el incidente");
});

test("7.2 REPRODUCCIÓN: una conexión sin ninguna marca desechable no era rechazada por nada (no existía evaluateDisposableTarget)", () => {
  // Antes de este módulo, no había NINGUNA función que evaluara esto -
  // documentado como ausencia, no como comportamiento de una función real.
  assert.equal(typeof evaluateDisposableTarget, "function", "el guard ahora SÍ existe -antes del fix este assert es la prueba de que faltaba");
});

test("7.3 REPRODUCCIÓN: un token/run_id incorrecto tampoco era verificado -no existía el concepto de run_id en ningún archivo antes de este módulo", () => {
  const result = evaluateDisposableTarget({ ...BASE_VALID, expectedRunId: "run-DIFERENTE" });
  assert.equal(result.ok, false);
});

test("7.4 REPRODUCCIÓN: application_name nunca se seteaba -SHOW application_name en los logs del incidente habría devuelto la cadena vacía por defecto", () => {
  const result = evaluateDisposableTarget({ ...BASE_VALID, applicationName: "" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /application_name/i);
});

// === Caso A: target desechable + marker + run-id correcto -> PASS ===
test("Caso A: target desechable, marker DISPOSABLE_TEST correcto, run_id coincide -> PASS", () => {
  const result = evaluateDisposableTarget(BASE_VALID);
  assert.equal(result.ok, true);
});

// === Caso B: puerto 15451 / base de revisión -> ABORT ANTES DEL PRIMER WRITE ===
test("Caso B: nombre de base coincide con el contenedor de revisión conocido -> ABORT, incluso si alguien le puso un marker falso", () => {
  const result = evaluateDisposableTarget({
    ...BASE_VALID,
    databaseName: "nexus_afterhours_realdata",
    databaseComment: "DISPOSABLE_TEST:run-abc123" // aunque tuviera marker, el nombre protegido gana
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /protegid/i);
});

// === Caso C: base con sufijo _test pero sin marker -> ABORT ===
test("Caso C: nombre de base parece desechable (_test) pero no tiene marker DISPOSABLE_TEST real -> ABORT", () => {
  const result = evaluateDisposableTarget({ ...BASE_VALID, databaseComment: null, databaseName: "algo_que_parece_test" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /marca|marker|DISPOSABLE_TEST/i);
});

test("Caso C-bis: comentario de base con formato ajeno (no generado por seedDisposableMarker) -> ABORT", () => {
  const result = evaluateDisposableTarget({ ...BASE_VALID, databaseComment: "algo que no es el formato esperado" });
  assert.equal(result.ok, false);
});

// === Caso D: marker válido pero run-id diferente -> ABORT ===
test("Caso D: marker DISPOSABLE_TEST válido pero el run_id no coincide con el de esta corrida -> ABORT", () => {
  const result = evaluateDisposableTarget({ ...BASE_VALID, databaseComment: "DISPOSABLE_TEST:run-OTRA-CORRIDA" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /run_id/i);
});

// === Caso E: target de producción -> ABORT ===
test("Caso E: nombre de base coincide con un patrón de Supabase cloud -> ABORT", () => {
  const result = evaluateDisposableTarget({ ...BASE_VALID, databaseName: "postgres", protectedDatabaseNames: new Set(["postgres"]) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /protegid/i);
});

// === Caso F: orden de variables/.env incorrecto -> ABORT (mismo mecanismo, target resultante sigue siendo evaluado) ===
test("Caso F: si una resolución de variables incorrecta termina apuntando al target de revisión, el guard lo rechaza igual -no depende de CÓMO se resolvió la variable", () => {
  // Simula el escenario real: CONTRACTS_TEST_DATABASE_URL terminó apuntando
  // a nexus_afterhours_realdata por un error de precedencia de .env -el
  // guard no necesita saber POR QUÉ, solo evalúa el resultado final.
  const result = evaluateDisposableTarget({ ...BASE_VALID, databaseName: "nexus_afterhours_realdata", databaseComment: null });
  assert.equal(result.ok, false);
});

// === Rol de integración inesperado ===
test("usuario conectado no coincide con el rol de integración esperado -> ABORT", () => {
  const result = evaluateDisposableTarget({ ...BASE_VALID, currentUser: "postgres", expectedUser: "integration_test" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /rol|usuario/i);
});

// === describeConnectionTarget: nunca expone credenciales ===
test("describeConnectionTarget extrae host/puerto/base/usuario SIN exponer la contraseña", () => {
  const desc = describeConnectionTarget("postgresql://myuser:supersecret@localhost:15451/nexus_afterhours_realdata");
  assert.equal(desc.host, "localhost");
  assert.equal(desc.port, "15451");
  assert.equal(desc.database, "nexus_afterhours_realdata");
  assert.equal(desc.user, "myuser");
  assert.equal(JSON.stringify(desc).includes("supersecret"), false, "la contraseña NUNCA debe aparecer en la descripción del target");
});

test("PROTECTED_DATABASE_NAMES incluye explícitamente nexus_afterhours_realdata", () => {
  assert.equal(PROTECTED_DATABASE_NAMES.has("nexus_afterhours_realdata"), true);
});

// === §6 - Caso G: applyContracts() (o cualquier caller directo) debe quedar protegido ===

test("isLikelyDisposableName reconoce sufijos _test/_disposable, con o sin número", () => {
  assert.equal(isLikelyDisposableName("nexus_wh_b1_test"), true);
  assert.equal(isLikelyDisposableName("nexus_wh_ddl_test_20260718"), true);
  assert.equal(isLikelyDisposableName("nexus_b1_disposable"), true);
  assert.equal(isLikelyDisposableName("nexus_afterhours_realdata"), false);
  assert.equal(isLikelyDisposableName("postgres"), false);
  assert.equal(isLikelyDisposableName(undefined), false);
});

test("assertWriteConfirmed: base con sufijo _test no requiere confirmación", () => {
  delete process.env.CONFIRM_WRITE_TARGET;
  assert.doesNotThrow(() => assertWriteConfirmed("postgresql://u:p@localhost:15460/nexus_b1_test"));
});

test("assertWriteConfirmed: base desconocida sin confirmación -> WriteConfirmationRequiredError, ninguna sentencia se ejecuta (función pura, no toca la red)", () => {
  delete process.env.CONFIRM_WRITE_TARGET;
  assert.throws(() => assertWriteConfirmed("postgresql://u:p@localhost:5432/algun_cliente_real"), WriteConfirmationRequiredError);
});

test("assertWriteConfirmed: base desconocida CON confirmación exacta host:puerto/base -> no lanza", () => {
  process.env.CONFIRM_WRITE_TARGET = "localhost:5432/algun_cliente_real";
  assert.doesNotThrow(() => assertWriteConfirmed("postgresql://u:p@localhost:5432/algun_cliente_real"));
  delete process.env.CONFIRM_WRITE_TARGET;
});

test("assertWriteConfirmed: confirmación con SOLO el nombre de la base (sin host:puerto) ya NO es suficiente -debe ser el token compuesto completo", () => {
  process.env.CONFIRM_WRITE_TARGET = "algun_cliente_real";
  assert.throws(() => assertWriteConfirmed("postgresql://u:p@localhost:5432/algun_cliente_real"), WriteConfirmationRequiredError);
  delete process.env.CONFIRM_WRITE_TARGET;
});

test("assertWriteConfirmed: confirmación válida para un puerto, pero el destino real usa OTRO puerto -> rechazada (cambiar cualquiera de los 3 invalida el token)", () => {
  process.env.CONFIRM_WRITE_TARGET = "localhost:5432/algun_cliente_real";
  assert.throws(() => assertWriteConfirmed("postgresql://u:p@localhost:5433/algun_cliente_real"), WriteConfirmationRequiredError);
  delete process.env.CONFIRM_WRITE_TARGET;
});

test("assertWriteConfirmed: confirmación válida para un host, pero el destino real usa OTRO host -> rechazada", () => {
  process.env.CONFIRM_WRITE_TARGET = "localhost:5432/algun_cliente_real";
  assert.throws(() => assertWriteConfirmed("postgresql://u:p@otrohost:5432/algun_cliente_real"), WriteConfirmationRequiredError);
  delete process.env.CONFIRM_WRITE_TARGET;
});

test("assertWriteConfirmed: una bandera genérica (ALLOW_WRITE=true) NUNCA es suficiente -debe nombrar host:puerto/base exactos", () => {
  process.env.CONFIRM_WRITE_TARGET = "true";
  assert.throws(() => assertWriteConfirmed("postgresql://u:p@localhost:5432/algun_cliente_real"), WriteConfirmationRequiredError);
  delete process.env.CONFIRM_WRITE_TARGET;
});

test("assertWriteConfirmed: nexus_afterhours_realdata NUNCA se habilita, ni con confirmación exacta -entorno protegido, escrituras productivas deshabilitadas en esta etapa", () => {
  process.env.CONFIRM_WRITE_TARGET = "localhost:15451/nexus_afterhours_realdata";
  assert.throws(() => assertWriteConfirmed("postgresql://u:p@localhost:15451/nexus_afterhours_realdata"), WriteConfirmationRequiredError);
  delete process.env.CONFIRM_WRITE_TARGET;
});

test("assertWriteConfirmed: host de Supabase cloud NUNCA se habilita en esta etapa", () => {
  process.env.CONFIRM_WRITE_TARGET = "db.qieeuaqfuctfntivjekn.supabase.co:5432/postgres";
  assert.throws(() => assertWriteConfirmed("postgresql://u:p@db.qieeuaqfuctfntivjekn.supabase.co:5432/postgres"), WriteConfirmationRequiredError);
  delete process.env.CONFIRM_WRITE_TARGET;
});

test("assertWriteConfirmed: pooler *.supabase.com también es protegido aunque la base no se llame postgres", () => {
  process.env.CONFIRM_WRITE_TARGET = "aws-0-test.pooler.supabase.com:6543/nexus";
  assert.throws(
    () => assertWriteConfirmed("postgresql://u:p@aws-0-test.pooler.supabase.com:6543/nexus"),
    WriteConfirmationRequiredError
  );
  delete process.env.CONFIRM_WRITE_TARGET;
});

test("detección Supabase normaliza mayúsculas y punto DNS final", () => {
  assert.equal(isSupabaseCloudHost("AWS-0-TEST.POOLER.SUPABASE.COM"), true);
  assert.equal(isSupabaseCloudHost("aws-0-test.pooler.supabase.com."), true);
  assert.equal(isSupabaseCloudHost("db.project.SUPABASE.CO."), true);
});

// === Corrección de cierre: migrate-to-supabase.js no debe quedar
// permanentemente inutilizable contra un target protegido, pero tampoco
// debe poder escribir ahí por defecto -exige DOS tokens simultáneos, cada
// uno host:puerto/base EXACTOS. El opt-in (allowProtectedWithDualConfirmation)
// es explícito por caller -sin él, el comportamiento por defecto (probado
// arriba) sigue intacto para contracts/holidays/working-hours/validate-supabase.

test("assertWriteConfirmed con allowProtectedWithDualConfirmation=true: target protegido SIN ninguna confirmación -> lanza", () => {
  delete process.env.CONFIRM_WRITE_TARGET;
  delete process.env.CONFIRM_PROTECTED_WRITE_TARGET;
  assert.throws(
    () => assertWriteConfirmed("postgresql://u:p@localhost:15451/nexus_afterhours_realdata", { allowProtectedWithDualConfirmation: true }),
    WriteConfirmationRequiredError
  );
});

test("assertWriteConfirmed con allowProtectedWithDualConfirmation=true: SOLO CONFIRM_WRITE_TARGET (normal), sin la protegida -> lanza", () => {
  process.env.CONFIRM_WRITE_TARGET = "localhost:15451/nexus_afterhours_realdata";
  delete process.env.CONFIRM_PROTECTED_WRITE_TARGET;
  assert.throws(
    () => assertWriteConfirmed("postgresql://u:p@localhost:15451/nexus_afterhours_realdata", { allowProtectedWithDualConfirmation: true }),
    WriteConfirmationRequiredError
  );
  delete process.env.CONFIRM_WRITE_TARGET;
});

test("assertWriteConfirmed con allowProtectedWithDualConfirmation=true: SOLO CONFIRM_PROTECTED_WRITE_TARGET, sin la normal -> lanza", () => {
  delete process.env.CONFIRM_WRITE_TARGET;
  process.env.CONFIRM_PROTECTED_WRITE_TARGET = "localhost:15451/nexus_afterhours_realdata";
  assert.throws(
    () => assertWriteConfirmed("postgresql://u:p@localhost:15451/nexus_afterhours_realdata", { allowProtectedWithDualConfirmation: true }),
    WriteConfirmationRequiredError
  );
  delete process.env.CONFIRM_PROTECTED_WRITE_TARGET;
});

test("assertWriteConfirmed con allowProtectedWithDualConfirmation=true: CONFIRM_PROTECTED_WRITE_TARGET apunta a OTRO host/puerto/base -> lanza (una confirmación para otro destino debe fallar)", () => {
  process.env.CONFIRM_WRITE_TARGET = "localhost:15451/nexus_afterhours_realdata";
  process.env.CONFIRM_PROTECTED_WRITE_TARGET = "localhost:15451/otra_base_distinta";
  assert.throws(
    () => assertWriteConfirmed("postgresql://u:p@localhost:15451/nexus_afterhours_realdata", { allowProtectedWithDualConfirmation: true }),
    WriteConfirmationRequiredError
  );
  delete process.env.CONFIRM_WRITE_TARGET;
  delete process.env.CONFIRM_PROTECTED_WRITE_TARGET;
});

test("assertWriteConfirmed con allowProtectedWithDualConfirmation=true: AMBAS confirmaciones exactas coincidentes con el destino efectivo -> NO lanza, permite continuar", () => {
  process.env.CONFIRM_WRITE_TARGET = "localhost:15451/nexus_afterhours_realdata";
  process.env.CONFIRM_PROTECTED_WRITE_TARGET = "localhost:15451/nexus_afterhours_realdata";
  assert.doesNotThrow(() =>
    assertWriteConfirmed("postgresql://u:p@localhost:15451/nexus_afterhours_realdata", { allowProtectedWithDualConfirmation: true })
  );
  delete process.env.CONFIRM_WRITE_TARGET;
  delete process.env.CONFIRM_PROTECTED_WRITE_TARGET;
});

test("assertWriteConfirmed con allowProtectedWithDualConfirmation=true: AMBAS coinciden entre sí pero NO con el host efectivo -> lanza", () => {
  process.env.CONFIRM_WRITE_TARGET = "localhost:15451/nexus_afterhours_realdata";
  process.env.CONFIRM_PROTECTED_WRITE_TARGET = "localhost:15451/nexus_afterhours_realdata";
  assert.throws(
    () => assertWriteConfirmed("postgresql://u:p@otrohost:15451/nexus_afterhours_realdata", { allowProtectedWithDualConfirmation: true }),
    WriteConfirmationRequiredError
  );
  delete process.env.CONFIRM_WRITE_TARGET;
  delete process.env.CONFIRM_PROTECTED_WRITE_TARGET;
});

test("assertWriteConfirmed con allowProtectedWithDualConfirmation=true: AMBAS coinciden entre sí pero NO con el puerto efectivo -> lanza", () => {
  process.env.CONFIRM_WRITE_TARGET = "localhost:15451/nexus_afterhours_realdata";
  process.env.CONFIRM_PROTECTED_WRITE_TARGET = "localhost:15451/nexus_afterhours_realdata";
  assert.throws(
    () => assertWriteConfirmed("postgresql://u:p@localhost:19999/nexus_afterhours_realdata", { allowProtectedWithDualConfirmation: true }),
    WriteConfirmationRequiredError
  );
  delete process.env.CONFIRM_WRITE_TARGET;
  delete process.env.CONFIRM_PROTECTED_WRITE_TARGET;
});

test("assertWriteConfirmed SIN allowProtectedWithDualConfirmation (default): un target protegido con AMBOS tokens exactos IGUAL lanza -el opt-in nunca es implícito", () => {
  process.env.CONFIRM_WRITE_TARGET = "localhost:15451/nexus_afterhours_realdata";
  process.env.CONFIRM_PROTECTED_WRITE_TARGET = "localhost:15451/nexus_afterhours_realdata";
  assert.throws(
    () => assertWriteConfirmed("postgresql://u:p@localhost:15451/nexus_afterhours_realdata"),
    WriteConfirmationRequiredError
  );
  delete process.env.CONFIRM_WRITE_TARGET;
  delete process.env.CONFIRM_PROTECTED_WRITE_TARGET;
});

test("assertWriteConfirmed con allowProtectedWithDualConfirmation=true: no acepta una bandera genérica en lugar del token compuesto para la confirmación protegida", () => {
  process.env.CONFIRM_WRITE_TARGET = "localhost:15451/nexus_afterhours_realdata";
  process.env.CONFIRM_PROTECTED_WRITE_TARGET = "true";
  assert.throws(
    () => assertWriteConfirmed("postgresql://u:p@localhost:15451/nexus_afterhours_realdata", { allowProtectedWithDualConfirmation: true }),
    WriteConfirmationRequiredError
  );
  delete process.env.CONFIRM_WRITE_TARGET;
  delete process.env.CONFIRM_PROTECTED_WRITE_TARGET;
});

// === NEXUS V3 - Protección Nexus V2/V3 (parseSupabaseProjectRef /
// assertKnownSupabaseProject): capa ADICIONAL sobre assertWriteConfirmed -
// dos proyectos Supabase distintos (V2 producción, V3 este trabajo)
// terminan en el MISMO sufijo .supabase.co, así que los tokens de
// confirmación host:puerto/base por sí solos no bastan para distinguirlos.

test("parseSupabaseProjectRef: conexión directa db.<ref>.supabase.co", () => {
  assert.equal(parseSupabaseProjectRef({ host: "db.qieeuaqfuctfntivjekn.supabase.co", user: "postgres" }), "qieeuaqfuctfntivjekn");
});

test("parseSupabaseProjectRef: pooler compartido, el ref viaja en el usuario (postgres.<ref>), nunca en el host", () => {
  assert.equal(parseSupabaseProjectRef({ host: "aws-0-us-east-1.pooler.supabase.com", user: "postgres.qieeuaqfuctfntivjekn" }), "qieeuaqfuctfntivjekn");
});

test("parseSupabaseProjectRef: host que no es Supabase cloud -> null, nunca inventa un ref", () => {
  assert.equal(parseSupabaseProjectRef({ host: "localhost", user: "postgres" }), null);
});

test("parseSupabaseProjectRef: host Supabase cloud pero usuario sin el formato pooler esperado -> null", () => {
  assert.equal(parseSupabaseProjectRef({ host: "aws-0-us-east-1.pooler.supabase.com", user: "postgres" }), null);
});

test("assertKnownSupabaseProject: destino no-Supabase (local desechable) nunca exige SUPABASE_PROJECT_REF_V3 -esta capa no aplica ahí", () => {
  delete process.env.SUPABASE_PROJECT_REF_V3;
  assert.doesNotThrow(() => assertKnownSupabaseProject("postgresql://u:p@localhost:55480/nexus_bi_dev_local_test"));
});

test("assertKnownSupabaseProject: destino Supabase cloud sin SUPABASE_PROJECT_REF_V3 en el entorno -> lanza, nunca asume por defecto", () => {
  delete process.env.SUPABASE_PROJECT_REF_V3;
  assert.throws(
    () => assertKnownSupabaseProject("postgresql://u:p@db.v3projectref.supabase.co:5432/postgres"),
    UnknownSupabaseProjectError
  );
});

test("assertKnownSupabaseProject: project ref del destino coincide EXACTO con SUPABASE_PROJECT_REF_V3 -> no lanza", () => {
  process.env.SUPABASE_PROJECT_REF_V3 = "v3projectref";
  assert.doesNotThrow(() => assertKnownSupabaseProject("postgresql://u:p@db.v3projectref.supabase.co:5432/postgres"));
  delete process.env.SUPABASE_PROJECT_REF_V3;
});

// Caso central de esta protección: tokens de confirmación EXACTOS (mismo
// host:puerto/base que asertWriteConfirmed ya habría aceptado), pero el
// project ref real es el de Nexus V2, no V3 -debe seguir bloqueado.
test("assertKnownSupabaseProject: tokens de confirmación host:puerto/base exactos pero project ref de V2 (no V3) -> IGUAL rechazado", () => {
  process.env.SUPABASE_PROJECT_REF_V3 = "v3projectref";
  process.env.CONFIRM_WRITE_TARGET = "db.v2projectref.supabase.co:5432/postgres";
  process.env.CONFIRM_PROTECTED_WRITE_TARGET = "db.v2projectref.supabase.co:5432/postgres";
  const connectionString = "postgresql://u:p@db.v2projectref.supabase.co:5432/postgres";

  // assertWriteConfirmed por sí solo aceptaría este destino (tokens exactos).
  assert.doesNotThrow(() => assertWriteConfirmed(connectionString, { allowProtectedWithDualConfirmation: true }));
  // assertKnownSupabaseProject, la capa adicional, lo rechaza igual -project ref equivocado.
  assert.throws(() => assertKnownSupabaseProject(connectionString), UnknownSupabaseProjectError);

  delete process.env.SUPABASE_PROJECT_REF_V3;
  delete process.env.CONFIRM_WRITE_TARGET;
  delete process.env.CONFIRM_PROTECTED_WRITE_TARGET;
});

test("assertKnownSupabaseProject: acepta un nombre de variable de entorno alternativo vía expectedProjectRefEnvVar", () => {
  process.env.SUPABASE_PROJECT_REF_STAGING = "stagingref";
  assert.doesNotThrow(() =>
    assertKnownSupabaseProject("postgresql://u:p@db.stagingref.supabase.co:5432/postgres", { expectedProjectRefEnvVar: "SUPABASE_PROJECT_REF_STAGING" })
  );
  delete process.env.SUPABASE_PROJECT_REF_STAGING;
});
