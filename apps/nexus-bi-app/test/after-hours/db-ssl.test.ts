import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSslMode,
  buildSslConfig,
  extractHostname,
  resolveConnectionString,
  isLocalHostname,
  describeConnectionForLogging,
  formatConnectionFailureLog,
  DbConnectionError
} from "../../lib/db.ts";

// ETAPA 6.6D-V - contrato explícito de SSL para lib/db.ts (SAFETY-1 sigue
// intacto, esto solo endurece cómo se decide `ssl` para el Pool de pg).
// Nunca infiere "local" solo por el hostname sin que DATABASE_SSL_MODE lo
// pida explícitamente - ver justificación en lib/db.ts.

test("isLocalHostname: reconoce localhost/127.0.0.1/::1 (con y sin corchetes IPv6)", () => {
  assert.equal(isLocalHostname("localhost"), true);
  assert.equal(isLocalHostname("127.0.0.1"), true);
  assert.equal(isLocalHostname("::1"), true);
  assert.equal(isLocalHostname("[::1]"), true);
  assert.equal(isLocalHostname("aws-0-us-east-1.pooler.supabase.com"), false);
  assert.equal(isLocalHostname("db.qieeuaqfuctfntivjekn.supabase.co"), false);
});

test("resolveSslMode: sin DATABASE_SSL_MODE, default es require incluso en localhost (nunca inferido silenciosamente)", () => {
  assert.equal(resolveSslMode("localhost", undefined), "require");
  assert.equal(resolveSslMode("aws-0-us-east-1.pooler.supabase.com", undefined), "require");
});

test("resolveSslMode: target remoto con SSL requerido explícito", () => {
  assert.equal(resolveSslMode("aws-0-us-east-1.pooler.supabase.com", "require"), "require");
});

test("resolveSslMode: localhost con SSL local deshabilitado explícitamente", () => {
  assert.equal(resolveSslMode("localhost", "disable"), "disable");
  assert.equal(resolveSslMode("127.0.0.1", "disable"), "disable");
  assert.equal(resolveSslMode("[::1]", "disable"), "disable");
});

test("resolveSslMode: rechaza disable contra un host remoto (nunca acepta certificados inseguros fuera de local)", () => {
  assert.throws(() => resolveSslMode("aws-0-us-east-1.pooler.supabase.com", "disable"), DbConnectionError);
  assert.throws(() => resolveSslMode("db.qieeuaqfuctfntivjekn.supabase.co", "disable"), DbConnectionError);
});

test("resolveSslMode: valor de SSL inválido lanza DbConnectionError con mensaje claro", () => {
  assert.throws(() => resolveSslMode("localhost", "verify-full"), (err: unknown) => {
    assert.ok(err instanceof DbConnectionError);
    assert.match((err as Error).message, /DATABASE_SSL_MODE inválido/);
    return true;
  });
});

test("buildSslConfig: disable -> false (sin handshake SSL)", () => {
  assert.equal(buildSslConfig("disable"), false);
});

test("buildSslConfig: require -> objeto con rejectUnauthorized (nunca true estricto, mismo comportamiento ya validado contra el pooler de Supabase)", () => {
  assert.deepEqual(buildSslConfig("require"), { rejectUnauthorized: false });
});

test("extractHostname: extrae el host de una connection string válida", () => {
  assert.equal(extractHostname("postgresql://user:pass@localhost:5432/db"), "localhost");
  assert.equal(extractHostname("postgresql://user:pass@[::1]:5432/db"), "[::1]");
});

test("extractHostname: connection string inválida lanza DbConnectionError", () => {
  assert.throws(() => extractHostname("no-es-una-url"), DbConnectionError);
});

test("resolveConnectionString: variable de conexión ausente lanza DbConnectionError sin exponer nada sensible", () => {
  const original = process.env.SUPABASE_DB_URL;
  delete process.env.SUPABASE_DB_URL;
  try {
    assert.throws(() => resolveConnectionString(), (err: unknown) => {
      assert.ok(err instanceof DbConnectionError);
      assert.match((err as Error).message, /SUPABASE_DB_URL/);
      return true;
    });
  } finally {
    if (original !== undefined) process.env.SUPABASE_DB_URL = original;
  }
});

test("describeConnectionForLogging: extrae host/port/database sin exponer usuario ni password", () => {
  const diag = describeConnectionForLogging("postgresql://someuser:supersecret@localhost:55480/nexus_bi_dev_local_test", "disable");
  assert.deepEqual(diag, { host: "localhost", port: "55480", database: "nexus_bi_dev_local_test", sslMode: "disable" });
  assert.equal(JSON.stringify(diag).includes("supersecret"), false);
  assert.equal(JSON.stringify(diag).includes("someuser"), false);
});

test("describeConnectionForLogging: usa 5432 por default si la connection string no trae puerto explícito", () => {
  const diag = describeConnectionForLogging("postgresql://user:pass@aws-0-us-east-1.pooler.supabase.com/postgres", "require");
  assert.equal(diag.port, "5432");
});

test("formatConnectionFailureLog: incluye reason/host/port/database/sslMode, nunca password", () => {
  const diag = describeConnectionForLogging("postgresql://user:supersecret@localhost:55480/nexus_bi_dev_local_test", "disable");
  const log = formatConnectionFailureLog(diag, "ECONNREFUSED");
  assert.match(log, /After-hours DB connection failed/);
  assert.match(log, /reason=ECONNREFUSED/);
  assert.match(log, /host=localhost/);
  assert.match(log, /port=55480/);
  assert.match(log, /database=nexus_bi_dev_local_test/);
  assert.match(log, /sslMode=disable/);
  assert.equal(log.includes("supersecret"), false);
});

test("resolveConnectionString: devuelve la connection string cuando está presente", () => {
  const original = process.env.SUPABASE_DB_URL;
  process.env.SUPABASE_DB_URL = "postgresql://user:pass@localhost:5432/db";
  try {
    assert.equal(resolveConnectionString(), "postgresql://user:pass@localhost:5432/db");
  } finally {
    if (original === undefined) delete process.env.SUPABASE_DB_URL;
    else process.env.SUPABASE_DB_URL = original;
  }
});
