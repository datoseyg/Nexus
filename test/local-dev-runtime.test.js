import assert from "node:assert/strict";
import test from "node:test";

import {
  attachSignalForwarding,
  buildNextEnvironment,
  ensureLocalRuntime,
  isHttpServiceAvailable,
  readSupabaseLocalConfig,
  resolveLocalAnalyticsDatabaseUrl,
  resolvePredevApiUrl,
  shouldUseShellForNpm,
  waitForHttpService
} from "../scripts/lib/local-dev-runtime.mjs";
import { EventEmitter } from "node:events";

const REPO_ROOT = "C:\\repo";
const SUPABASE = `${process.execPath} C:\\repo\\node_modules\\supabase\\dist\\supabase.js`;

test("npm usa shell en Windows para evitar spawn EINVAL", () => {
  assert.equal(shouldUseShellForNpm("win32"), true);
  assert.equal(shouldUseShellForNpm("linux"), false);
});

function createRuntime(overrides = {}) {
  const calls = [];
  const responses = overrides.responses ?? new Map();
  return {
    calls,
    options: {
      repoRoot: REPO_ROOT,
      exists: path => overrides.missingPath !== path,
      readText: () => overrides.configText ?? "project_id = \"test\"\n[api]\nport = 54321\n[db]\nport = 54322\n[studio]\nport = 54323\n",
      run(command, args) {
        calls.push([command, ...args]);
        const key = [command, ...args].join(" ");
        return responses.get(key) ?? { status: 0, stdout: "", stderr: "" };
      },
      probeApi: overrides.probeApi ?? (async () => true),
      waitForApi: overrides.waitForApi ?? (async () => true),
      checkPort: overrides.checkPort ?? (async () => ({ available: true })),
      platform: "win32"
    }
  };
}

test("Docker no disponible aborta con mensaje accionable", async () => {
  const runtime = createRuntime({
    responses: new Map([["docker info", { status: 1, stdout: "", stderr: "daemon unavailable" }]])
  });

  await assert.rejects(
    ensureLocalRuntime(runtime.options),
    /Docker Desktop no est.+ disponible/
  );
});

test("config.toml ausente aborta sin ejecutar supabase init", async () => {
  const configPath = "C:\\repo\\supabase\\config.toml";
  const runtime = createRuntime({ missingPath: configPath });

  await assert.rejects(ensureLocalRuntime(runtime.options), /supabase[\\/]config\.toml/);
  assert.equal(runtime.calls.some(call => call.includes("init")), false);
});

test("Supabase detenido solicita start exactamente una vez", async () => {
  const runtime = createRuntime({
    probeApi: async () => false,
    responses: new Map([
      [`${SUPABASE} status --workdir C:\\repo`, { status: 1, stdout: "", stderr: "stopped" }],
      [`${SUPABASE} start --workdir C:\\repo`, { status: 0, stdout: "started", stderr: "" }]
    ])
  });

  const result = await ensureLocalRuntime(runtime.options);
  assert.equal(result.action, "started");
  assert.equal(runtime.calls.filter(call => call.includes("start")).length, 1);
});

test("Supabase ya activo no vuelve a iniciarse", async () => {
  const runtime = createRuntime({ probeApi: async () => true });
  const result = await ensureLocalRuntime(runtime.options);

  assert.equal(result.action, "already-running");
  assert.equal(runtime.calls.some(call => call.includes("start")), false);
});

test("respeta el puerto API definido en config.toml", async () => {
  const runtime = createRuntime({
    configText: "project_id = \"test\"\n[api]\nenabled = true\n\nport = 44321\n[db]\nport = 44322\n[studio]\nport = 44323\n",
    probeApi: async url => url === "http://127.0.0.1:44321"
  });
  const result = await ensureLocalRuntime(runtime.options);
  assert.equal(result.apiUrl, "http://127.0.0.1:44321");
});

test("readSupabaseLocalConfig es la única fuente de project/API/DB/Studio y puertos auxiliares", () => {
  const config = readSupabaseLocalConfig(`
project_id = "eyg-nexus-local"
[api]
port = 13321
[db]
port = 13322
shadow_port = 13320
[db.pooler]
enabled = false
port = 13329
[studio]
enabled = true
port = 13323
[local_smtp]
enabled = true
port = 13324
[analytics]
enabled = true
port = 13327
`);

  assert.equal(config.projectId, "eyg-nexus-local");
  assert.equal(config.apiPort, 13321);
  assert.equal(config.dbPort, 13322);
  assert.equal(config.studioPort, 13323);
  assert.deepEqual(config.configuredPorts, [13320, 13321, 13322, 13323, 13324, 13327, 13329]);
});

test("bloque ocupado aborta antes de iniciar Supabase", async () => {
  const runtime = createRuntime({
    configText: "project_id=\"x\"\n[api]\nport=13321\n[db]\nport=13322\n[studio]\nport=13323\n",
    probeApi: async () => false,
    checkPort: async port => port === 13322
      ? { available: false, reason: "IN_USE" }
      : { available: true },
    responses: new Map([[`${SUPABASE} status --workdir C:\\repo`, { status: 1, stdout: "", stderr: "stopped" }]])
  });

  await assert.rejects(ensureLocalRuntime(runtime.options), /13322.*ocupado/i);
  assert.equal(runtime.calls.some(call => call.includes("start")), false);
});

test("bloque excluido aborta con diagnóstico accionable", async () => {
  const runtime = createRuntime({
    configText: "project_id=\"x\"\n[api]\nport=13321\n[db]\nport=13322\n[studio]\nport=13323\n",
    probeApi: async () => false,
    checkPort: async port => port === 13321
      ? { available: false, reason: "EXCLUDED" }
      : { available: true },
    responses: new Map([[`${SUPABASE} status --workdir C:\\repo`, { status: 1, stdout: "", stderr: "stopped" }]])
  });

  await assert.rejects(ensureLocalRuntime(runtime.options), /13321.*excluido/i);
});

test("dev:local inyecta API local y base analítica local aunque .env.local apunte remoto", () => {
  const environment = buildNextEnvironment(
    "http://127.0.0.1:13321",
    "postgresql://hidden@localhost:55480/nexus",
    {
    SUPABASE_DB_URL: "postgresql://hidden@remote.example:6543/postgres",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321"
    }
  );
  assert.equal(environment.NEXT_PUBLIC_SUPABASE_URL, "http://127.0.0.1:13321");
  assert.equal(environment.SUPABASE_DB_URL, "postgresql://hidden@localhost:55480/nexus");
  assert.equal(environment.DATABASE_SSL_MODE, "disable");
});

test("base analítica canónica se resuelve desde WORKING_HOURS_DB_URL y debe ser local", () => {
  assert.equal(
    resolveLocalAnalyticsDatabaseUrl({}, "WORKING_HOURS_DB_URL=postgresql://hidden@localhost:55480/nexus\n"),
    "postgresql://hidden@localhost:55480/nexus"
  );
  assert.throws(
    () => resolveLocalAnalyticsDatabaseUrl({ WORKING_HOURS_DB_URL: "postgresql://hidden@remote.example:6543/postgres" }),
    /debe apuntar a localhost/i
  );
});

test("predev prioriza la URL inyectada y en standalone lee .env.local", () => {
  assert.equal(
    resolvePredevApiUrl({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:13321" }, "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321"),
    "http://127.0.0.1:13321"
  );
  assert.equal(
    resolvePredevApiUrl({}, "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\n"),
    "http://127.0.0.1:54321"
  );
});

test("API que tarda espera con polling condicionado", async () => {
  let attempts = 0;
  const available = await waitForHttpService({
    url: "http://127.0.0.1:54321",
    timeoutMs: 100,
    pollIntervalMs: 1,
    now: (() => { let value = 0; return () => value += 10; })(),
    sleep: async () => {},
    probe: async () => ++attempts === 3
  });

  assert.equal(available, true);
  assert.equal(attempts, 3);
});

test("API que nunca responde aborta al vencer el timeout", async () => {
  const available = await waitForHttpService({
    url: "http://127.0.0.1:54321",
    timeoutMs: 25,
    pollIntervalMs: 1,
    now: (() => { let value = 0; return () => value += 10; })(),
    sleep: async () => {},
    probe: async () => false
  });

  assert.equal(available, false);
});

test("cualquier respuesta HTTP, incluidos 401 y 404, prueba disponibilidad", async () => {
  for (const status of [200, 401, 404, 503]) {
    const available = await isHttpServiceAvailable("http://127.0.0.1:54321", {
      fetchImpl: async () => new Response(null, { status })
    });
    assert.equal(available, true, `status=${status}`);
  }
});

test("un error de red no cuenta como servicio disponible", async () => {
  const available = await isHttpServiceAvailable("http://127.0.0.1:54321", {
    fetchImpl: async () => { throw Object.assign(new Error("connect refused"), { code: "ECONNREFUSED" }); }
  });
  assert.equal(available, false);
});

test("un stack activo pero API inaccesible no se reinicia ni oculta el fallo", async () => {
  const runtime = createRuntime({
    probeApi: async () => false,
    responses: new Map([
      [`${SUPABASE} status --workdir C:\\repo`, { status: 0, stdout: "running", stderr: "" }]
    ])
  });

  await assert.rejects(ensureLocalRuntime(runtime.options), /figura activo.*API no responde/i);
  assert.equal(runtime.calls.some(call => call.includes("stop")), false);
  assert.equal(runtime.calls.some(call => call.includes("start")), false);
});

test("fallo de binding reservado se traduce a diagnóstico seguro", async () => {
  const runtime = createRuntime({
    probeApi: async () => false,
    responses: new Map([
      [`${SUPABASE} status --workdir C:\\repo`, { status: 1, stdout: "", stderr: "stopped" }],
      [`${SUPABASE} start --workdir C:\\repo`, {
        status: 1,
        stdout: "",
        stderr: "ports are not available: bind: access permissions"
      }]
    ])
  });

  await assert.rejects(ensureLocalRuntime(runtime.options), /puerto local[\s\S]*reservado por Windows/i);
});

test("timeout de la CLI aborta con diagnóstico acotado", async () => {
  const runtime = createRuntime({
    probeApi: async () => false,
    responses: new Map([
      [`${SUPABASE} status --workdir C:\\repo`, { status: 1, stdout: "", stderr: "stopped" }],
      [`${SUPABASE} start --workdir C:\\repo`, {
        status: null,
        stdout: "",
        stderr: "",
        error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })
      }]
    ])
  });

  await assert.rejects(ensureLocalRuntime(runtime.options), /CLI.*timeout limitado/i);
});

test("Ctrl+C termina Nexus sin ejecutar teardown de Supabase", () => {
  const parent = new EventEmitter();
  const signals = [];
  const child = { kill: signal => signals.push(signal) };
  const detach = attachSignalForwarding(parent, child);

  parent.emit("SIGINT");
  assert.deepEqual(signals, ["SIGINT"]);
  detach();
  parent.emit("SIGTERM");
  assert.deepEqual(signals, ["SIGINT"]);
});
