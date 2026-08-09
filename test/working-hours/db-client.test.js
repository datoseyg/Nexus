// Release productivo NEXUS V3 - blocker: src/working-hours/db-client.js
// forzaba `ssl: { rejectUnauthorized: false }` para cualquier host remoto,
// cifrando la conexión sin verificar jamás la identidad del certificado del
// servidor (vulnerable a MITM). Este archivo es el ÚNICO cliente Postgres
// del camino BUILD_WORKING_HOURS (scripts/pipeline/run-data-refresh.mjs,
// disparado por .github/workflows/data-refresh.yml) - src/working-hours/db-writer.js
// nunca crea su propia conexión, siempre reutiliza el pool de acá.
//
// Unitario, sin red ni DB real: pg.Pool es lazy (nunca conecta hasta el
// primer .query()/.connect()), así que createPool() puede probarse por
// completo -incluida la config ssl real que terminaría usando- inspeccionando
// pool.options y cerrando el pool de inmediato, sin tocar Cloud.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getConnectionString, createPool, buildSslConfig, assertNotProductionHost } from "../../src/working-hours/db-client.js";

const GUARD_ENV_VARS = ["WORKING_HOURS_DB_URL", "CONFIRM_WRITE_TARGET", "CONFIRM_PROTECTED_WRITE_TARGET", "SUPABASE_PROJECT_REF_V3"];
function clearEnv() {
  for (const name of GUARD_ENV_VARS) delete process.env[name];
}

const LOCAL_URL = "postgresql://user:pass@localhost:55480/nexus_bi_dev_local_test";
const LOCAL_IP_URL = "postgresql://user:pass@127.0.0.1:55480/nexus_bi_dev_local_test";
// Host remoto genérico, deliberadamente NO reconocido como Supabase cloud
// (isSupabaseCloudHost solo mira sufijos .supabase.co/.supabase.com) - aísla
// el comportamiento de SSL puro sin el guard de escritura protegida de por
// medio (ver los tests dedicados a ese guard más abajo).
const REMOTE_GENERIC_URL = "postgresql://user:pass@some-remote-postgres.example.com:5432/postgres";
const REMOTE_POOLER_SHAPED_URL = "postgresql://postgres.projectref:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres";

// Mismo patrón que test/lib/supabase-write-guard-wiring.test.js para probar
// assertSupabaseWriteAuthorized contra un destino V3 real y autorizado.
const V3_HOST = "db.v3projectref.supabase.co";
const V3_URL = `postgresql://postgres:pw@${V3_HOST}:5432/postgres`;
const V3_TOKEN = `${V3_HOST}:5432/postgres`;

// --- 1: host local conserva ssl:false -----------------------------------
test("buildSslConfig: host local (localhost/127.0.0.1) -> ssl:false, sin cambios respecto al contrato existente", () => {
  assert.equal(buildSslConfig(LOCAL_URL), false);
  assert.equal(buildSslConfig(LOCAL_IP_URL), false);
});

// --- 2: host remoto produce rejectUnauthorized:true ----------------------
test("buildSslConfig: host remoto -> { rejectUnauthorized: true } (verificación TLS estricta, ya no rejectUnauthorized:false)", () => {
  assert.deepEqual(buildSslConfig(REMOTE_GENERIC_URL), { rejectUnauthorized: true });
});

// --- 3: ningún camino remoto produce rejectUnauthorized:false -------------
test("buildSslConfig: ningún host remoto produce rejectUnauthorized:false bajo ninguna forma de connection string", () => {
  for (const url of [REMOTE_GENERIC_URL, REMOTE_POOLER_SHAPED_URL, V3_URL]) {
    const config = buildSslConfig(url);
    assert.notEqual(config, false, `${url} debe exigir TLS`);
    assert.equal(config.rejectUnauthorized, true, `${url} nunca debe producir rejectUnauthorized:false`);
    assert.equal(Object.prototype.hasOwnProperty.call(config, "ca"), false, "nunca pasa una CA explícita acá - se apoya en NODE_EXTRA_CA_CERTS/el trust store nativo de Node");
  }
});

// --- 5: getConnectionString/createPool - comportamiento existente intacto salvo TLS ---
test("getConnectionString: lee WORKING_HOURS_DB_URL; lanza con mensaje claro si falta (sin cambios)", () => {
  clearEnv();
  try {
    assert.throws(() => getConnectionString(), /WORKING_HOURS_DB_URL/);
    process.env.WORKING_HOURS_DB_URL = LOCAL_URL;
    assert.equal(getConnectionString(), LOCAL_URL);
  } finally {
    clearEnv();
  }
});

test("createPool: host local -> Pool con ssl:false, application_name/max sin cambios (default 'working-hours-build'/4)", async () => {
  clearEnv();
  process.env.WORKING_HOURS_DB_URL = LOCAL_URL;
  try {
    const pool = createPool();
    try {
      assert.equal(pool.options.ssl, false);
      assert.equal(pool.options.max, 4);
      assert.equal(pool.options.application_name, "working-hours-build");
    } finally {
      await pool.end();
    }
  } finally {
    clearEnv();
  }
});

test("createPool: applicationName override sigue funcionando igual que antes", async () => {
  clearEnv();
  process.env.WORKING_HOURS_DB_URL = LOCAL_URL;
  try {
    const pool = createPool({ applicationName: "working-hours-apply:test1234" });
    try {
      assert.equal(pool.options.application_name, "working-hours-apply:test1234");
    } finally {
      await pool.end();
    }
  } finally {
    clearEnv();
  }
});

test("createPool: host remoto no-Supabase -> Pool con ssl:{rejectUnauthorized:true} (el blocker corregido, extremo a extremo)", async () => {
  clearEnv();
  process.env.WORKING_HOURS_DB_URL = REMOTE_GENERIC_URL;
  try {
    const pool = createPool();
    try {
      assert.deepEqual(pool.options.ssl, { rejectUnauthorized: true });
      assert.equal(pool.options.max, 4);
    } finally {
      await pool.end();
    }
  } finally {
    clearEnv();
  }
});

// --- 7: no se cambia el guard de escrituras protegidas --------------------
test("createPool: host Supabase cloud SIN confirmación -> sigue rechazado por assertNotProductionHost (guard sin cambios), nunca llega a crear el Pool", () => {
  clearEnv();
  process.env.WORKING_HOURS_DB_URL = V3_URL;
  try {
    assert.throws(() => createPool(), (err) => {
      assert.match(err.message, /protegido|CONFIRM_WRITE_TARGET/);
      return true;
    });
  } finally {
    clearEnv();
  }
});

test("assertNotProductionHost: sigue exportada y con el mismo comportamiento (no tocada por esta corrección)", () => {
  clearEnv();
  assert.doesNotThrow(() => assertNotProductionHost(LOCAL_URL));
  try {
    assert.throws(() => assertNotProductionHost(V3_URL));
  } finally {
    clearEnv();
  }
});

test("createPool: host Supabase cloud CON confirmación completa -> el guard de escritura sigue exigiendo lo mismo de siempre, y el Pool resultante ya no usa rejectUnauthorized:false", async () => {
  clearEnv();
  process.env.WORKING_HOURS_DB_URL = V3_URL;
  process.env.CONFIRM_WRITE_TARGET = V3_TOKEN;
  process.env.CONFIRM_PROTECTED_WRITE_TARGET = V3_TOKEN;
  process.env.SUPABASE_PROJECT_REF_V3 = "v3projectref";
  try {
    const pool = createPool();
    try {
      assert.deepEqual(pool.options.ssl, { rejectUnauthorized: true });
    } finally {
      await pool.end();
    }
  } finally {
    clearEnv();
  }
});

// --- 4: no se imprimen credentials -----------------------------------------
test("createPool: nunca imprime la connection string ni credenciales en la ruta feliz (local o remota)", async () => {
  clearEnv();
  const originalLog = console.log;
  const originalError = console.error;
  const logs = [];
  console.log = (...args) => logs.push(args.map(String).join(" "));
  console.error = (...args) => logs.push(args.map(String).join(" "));

  try {
    process.env.WORKING_HOURS_DB_URL = "postgresql://someuser:supersecret@localhost:55480/nexus_bi_dev_local_test";
    const localPool = createPool();
    await localPool.end();

    process.env.WORKING_HOURS_DB_URL = "postgresql://otheruser:othersecret@some-remote-postgres.example.com:5432/postgres";
    const remotePool = createPool();
    await remotePool.end();
  } finally {
    console.log = originalLog;
    console.error = originalError;
    clearEnv();
  }

  const combined = logs.join("\n");
  assert.equal(combined.includes("supersecret"), false);
  assert.equal(combined.includes("someuser"), false);
  assert.equal(combined.includes("othersecret"), false);
  assert.equal(combined.includes("otheruser"), false);
});
