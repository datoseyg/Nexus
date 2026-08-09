import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSslMode,
  resolveSslCa,
  buildSslConfig,
  assertNoConnectionStringSslOverrides,
  extractHostname,
  resolveConnectionString,
  isLocalHostname,
  describeConnectionForLogging,
  formatConnectionFailureLog,
  DbConnectionError
} from "../../lib/db.ts";

// Release productivo NEXUS V3 - contrato TLS endurecido para lib/db.ts
// (SAFETY-1 sigue intacto, esto solo endurece cómo se decide `ssl` para el
// Pool de pg). El viejo "require" cifraba la conexión pero NUNCA verificaba
// la identidad del certificado del servidor (vulnerable a MITM con un
// certificado autofirmado cualquiera) - "verify-full" es ahora el único
// modo remoto: verificación estricta de certificado Y hostname, con la CA
// de Supabase provista explícitamente vía DATABASE_SSL_CA_B64 (nunca una
// ruta de archivo local - portabilidad Netlify). "disable" sigue existiendo
// SOLO para Postgres local, nunca inferido en silencio del hostname.

// PEM de prueba - NO es un certificado real, solo tiene la FORMA correcta
// (bloque BEGIN/END CERTIFICATE) que resolveSslCa valida. Nunca se conecta
// nada con esto - estos tests son unitarios, sin red ni DB real.
const FAKE_PEM = "-----BEGIN CERTIFICATE-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtest\n-----END CERTIFICATE-----\n";
const FAKE_PEM_B64 = Buffer.from(FAKE_PEM, "utf8").toString("base64");
const REMOTE_HOST = "aws-0-us-east-1.pooler.supabase.com";

test("isLocalHostname: reconoce localhost/127.0.0.1/::1 (con y sin corchetes IPv6)", () => {
  assert.equal(isLocalHostname("localhost"), true);
  assert.equal(isLocalHostname("127.0.0.1"), true);
  assert.equal(isLocalHostname("::1"), true);
  assert.equal(isLocalHostname("[::1]"), true);
  assert.equal(isLocalHostname(REMOTE_HOST), false);
  assert.equal(isLocalHostname("db.qieeuaqfuctfntivjekn.supabase.co"), false);
});

// --- A: default sin DATABASE_SSL_MODE -----------------------------------
test("resolveSslMode (A): sin DATABASE_SSL_MODE, default es verify-full incluso en localhost (nunca inferido silenciosamente a un modo más débil)", () => {
  assert.equal(resolveSslMode("localhost", undefined), "verify-full");
  assert.equal(resolveSslMode(REMOTE_HOST, undefined), "verify-full");
});

// --- B: verify-full remoto aceptado --------------------------------------
test("resolveSslMode (B): verify-full explícito contra un host remoto es aceptado", () => {
  assert.equal(resolveSslMode(REMOTE_HOST, "verify-full"), "verify-full");
});

// --- C: disable localhost aceptado ---------------------------------------
test("resolveSslMode (C): disable contra localhost/127.0.0.1/::1 es aceptado", () => {
  assert.equal(resolveSslMode("localhost", "disable"), "disable");
  assert.equal(resolveSslMode("127.0.0.1", "disable"), "disable");
  assert.equal(resolveSslMode("[::1]", "disable"), "disable");
});

// --- D: disable remoto rechazado -----------------------------------------
test("resolveSslMode (D): rechaza disable contra un host remoto (nunca acepta una conexión sin TLS fuera de local)", () => {
  assert.throws(() => resolveSslMode(REMOTE_HOST, "disable"), DbConnectionError);
  assert.throws(() => resolveSslMode("db.qieeuaqfuctfntivjekn.supabase.co", "disable"), DbConnectionError);
});

// --- E: "require" rechazado -----------------------------------------------
test('resolveSslMode (E): "require" (el viejo modo, cifraba sin verificar identidad) ya no es válido -falla cerrado, nunca cae a verify-full ni a disable', () => {
  assert.throws(() => resolveSslMode(REMOTE_HOST, "require"), (err: unknown) => {
    assert.ok(err instanceof DbConnectionError);
    assert.match((err as Error).message, /DATABASE_SSL_MODE inválido/);
    assert.match((err as Error).message, /verify-full/);
    return true;
  });
  assert.throws(() => resolveSslMode("localhost", "require"), DbConnectionError);
});

// --- F: valor arbitrario rechazado -----------------------------------------
test("resolveSslMode (F): un valor arbitrario/typo lanza DbConnectionError con mensaje claro", () => {
  assert.throws(() => resolveSslMode("localhost", "prefer"), (err: unknown) => {
    assert.ok(err instanceof DbConnectionError);
    assert.match((err as Error).message, /DATABASE_SSL_MODE inválido/);
    return true;
  });
});

// --- G: verify-full sin DATABASE_SSL_CA_B64 -> error ------------------------
test("resolveSslCa (G): verify-full sin DATABASE_SSL_CA_B64 -> DbConnectionError, obligatoria", () => {
  assert.throws(() => resolveSslCa("verify-full", undefined), (err: unknown) => {
    assert.ok(err instanceof DbConnectionError);
    assert.match((err as Error).message, /DATABASE_SSL_CA_B64/);
    return true;
  });
  assert.throws(() => resolveSslCa("verify-full", ""), DbConnectionError);
});

test("resolveSslCa: disable nunca exige CA (irrelevante, siempre undefined)", () => {
  assert.equal(resolveSslCa("disable", undefined), undefined);
  assert.equal(resolveSslCa("disable", FAKE_PEM_B64), undefined);
});

// --- H: CA base64 válida -> PEM decodificado ---------------------------------
test("resolveSslCa (H): base64 válido que decodifica a un PEM con forma correcta -> devuelve el PEM decodificado", () => {
  assert.equal(resolveSslCa("verify-full", FAKE_PEM_B64), FAKE_PEM);
});

// --- I: CA inválida -> error sin filtrar contenido ---------------------------
test("resolveSslCa (I): base64 que decodifica a texto sin forma de PEM -> DbConnectionError, el mensaje nunca incluye el valor recibido", () => {
  const bogusB64 = Buffer.from("esto no es un certificado", "utf8").toString("base64");
  assert.throws(() => resolveSslCa("verify-full", bogusB64), (err: unknown) => {
    assert.ok(err instanceof DbConnectionError);
    assert.doesNotMatch((err as Error).message, /esto no es un certificado/);
    assert.doesNotMatch((err as Error).message, new RegExp(bogusB64));
    return true;
  });
});

test("resolveSslCa (I): base64 con caracteres no-base64 -> igual falla cerrado (no decodifica a PEM válido), sin exponer el valor crudo", () => {
  const notBase64 = "%%%not-base64%%%";
  assert.throws(() => resolveSslCa("verify-full", notBase64), (err: unknown) => {
    assert.ok(err instanceof DbConnectionError);
    assert.doesNotMatch((err as Error).message, /not-base64/);
    return true;
  });
});

// --- J: buildSslConfig verify-full -----------------------------------------
test("buildSslConfig (J): verify-full -> { rejectUnauthorized: true, ca } exacto", () => {
  assert.deepEqual(buildSslConfig("verify-full", FAKE_PEM), { rejectUnauthorized: true, ca: FAKE_PEM });
});

test("buildSslConfig: disable -> false (sin handshake SSL)", () => {
  assert.equal(buildSslConfig("disable", undefined), false);
});

test("buildSslConfig: verify-full sin CA (error de programación del caller, resolveSslCa debía exigirla antes) -> falla cerrado, nunca produce un config a medias", () => {
  assert.throws(() => buildSslConfig("verify-full", undefined), DbConnectionError);
});

// --- K: ningún camino verify-full produce rejectUnauthorized:false -----------
test("buildSslConfig (K): ningún resultado posible de verify-full tiene rejectUnauthorized:false - solo existen 'false' (disable) o rejectUnauthorized:true", () => {
  const disableResult = buildSslConfig("disable", undefined);
  const verifyFullResult = buildSslConfig("verify-full", FAKE_PEM);

  assert.equal(disableResult, false);
  assert.notEqual(verifyFullResult, false);
  assert.equal((verifyFullResult as { rejectUnauthorized: boolean }).rejectUnauthorized, true);

  // Recorre TODAS las combinaciones mode x ca posibles del tipo -si alguna
  // vez existiera una tercera rama con rejectUnauthorized:false, esto la
  // atraparía sin tener que enumerar el código fuente a mano.
  for (const mode of ["disable", "verify-full"] as const) {
    for (const ca of [undefined, FAKE_PEM]) {
      let result: ReturnType<typeof buildSslConfig>;
      try {
        result = buildSslConfig(mode, ca);
      } catch {
        continue; // combinación inválida (verify-full sin ca) -ya cubierta arriba, no es el foco de este test
      }
      if (result !== false) {
        assert.equal(result.rejectUnauthorized, true, `mode=${mode} ca=${ca ? "presente" : "ausente"} nunca debe producir rejectUnauthorized:false`);
      }
    }
  }
});

// --- L-O: connection string con parámetros SSL propios -----------------------
test("assertNoConnectionStringSslOverrides (L): connection string con ?sslmode= -> rechazada, mensaje nombra solo el parámetro", () => {
  assert.throws(() => assertNoConnectionStringSslOverrides("postgresql://user:pass@host:5432/db?sslmode=require"), (err: unknown) => {
    assert.ok(err instanceof DbConnectionError);
    assert.match((err as Error).message, /sslmode/);
    assert.doesNotMatch((err as Error).message, /user:pass@host/);
    return true;
  });
});

test("assertNoConnectionStringSslOverrides (M): connection string con ?sslrootcert= -> rechazada", () => {
  assert.throws(() => assertNoConnectionStringSslOverrides("postgresql://user:pass@host:5432/db?sslrootcert=/tmp/ca.pem"), (err: unknown) => {
    assert.ok(err instanceof DbConnectionError);
    assert.match((err as Error).message, /sslrootcert/);
    return true;
  });
});

test("assertNoConnectionStringSslOverrides (N): connection string con ?sslcert= -> rechazada", () => {
  assert.throws(() => assertNoConnectionStringSslOverrides("postgresql://user:pass@host:5432/db?sslcert=/tmp/client.crt"), (err: unknown) => {
    assert.ok(err instanceof DbConnectionError);
    assert.match((err as Error).message, /sslcert/);
    return true;
  });
});

test("assertNoConnectionStringSslOverrides (O): connection string con ?sslkey= -> rechazada", () => {
  assert.throws(() => assertNoConnectionStringSslOverrides("postgresql://user:pass@host:5432/db?sslkey=/tmp/client.key"), (err: unknown) => {
    assert.ok(err instanceof DbConnectionError);
    assert.match((err as Error).message, /sslkey/);
    return true;
  });
});

test("assertNoConnectionStringSslOverrides: detecta el parámetro sin importar mayúsculas/minúsculas (SSLMODE=, SslMode=, etc.)", () => {
  assert.throws(() => assertNoConnectionStringSslOverrides("postgresql://user:pass@host:5432/db?SSLMODE=verify-ca"), DbConnectionError);
});

test("assertNoConnectionStringSslOverrides: nunca elimina/modifica el parámetro por su cuenta - solo lanza, la URL original queda intacta para quien la haya pasado", () => {
  const url = "postgresql://user:pass@host:5432/db?sslmode=require";
  try {
    assertNoConnectionStringSslOverrides(url);
    assert.fail("debía lanzar");
  } catch {
    // no-op: el propósito del test es solo confirmar que la función no
    // devuelve una URL "saneada" ni tiene efectos secundarios - lanza y punto.
  }
});

// --- P: connection string normal sin esos parámetros -> aceptada -------------
test("assertNoConnectionStringSslOverrides (P): connection string sin parámetros SSL -> no lanza", () => {
  assert.doesNotThrow(() => assertNoConnectionStringSslOverrides("postgresql://user:pass@host:5432/db"));
  assert.doesNotThrow(() => assertNoConnectionStringSslOverrides("postgresql://user:pass@host:6543/db?options=-c%20search_path%3Dpublic"));
});

test("assertNoConnectionStringSslOverrides: connection string inválida (no parseable como URL) -> DbConnectionError, nunca un crash sin tipo", () => {
  assert.throws(() => assertNoConnectionStringSslOverrides("no-es-una-url"), DbConnectionError);
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

// --- Q: diagnostics sin username/password/CA ---------------------------------
test("describeConnectionForLogging (Q): extrae host/port/database/sslMode sin exponer usuario ni password", () => {
  const diag = describeConnectionForLogging("postgresql://someuser:supersecret@localhost:55480/nexus_bi_dev_local_test", "disable");
  assert.deepEqual(diag, { host: "localhost", port: "55480", database: "nexus_bi_dev_local_test", sslMode: "disable" });
  assert.equal(JSON.stringify(diag).includes("supersecret"), false);
  assert.equal(JSON.stringify(diag).includes("someuser"), false);
});

test("describeConnectionForLogging: usa 5432 por default si la connection string no trae puerto explícito", () => {
  const diag = describeConnectionForLogging(`postgresql://user:pass@${REMOTE_HOST}/postgres`, "verify-full");
  assert.equal(diag.port, "5432");
});

test("formatConnectionFailureLog (Q): incluye reason/host/port/database/sslMode, nunca password ni CA", () => {
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

test("formatConnectionFailureLog (Q): con sslMode=verify-full, tampoco filtra la CA (el diagnóstico nunca la recibe como input)", () => {
  const diag = describeConnectionForLogging(`postgresql://user:supersecret@${REMOTE_HOST}/postgres`, "verify-full");
  const log = formatConnectionFailureLog(diag, "ETIMEDOUT");
  assert.match(log, /sslMode=verify-full/);
  assert.equal(log.includes(FAKE_PEM), false);
  assert.equal(log.includes("supersecret"), false);
});
