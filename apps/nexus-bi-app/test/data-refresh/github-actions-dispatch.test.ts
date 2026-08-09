// NEXUS V3 - puente POST /api/data-refresh/runs -> GitHub Actions
// workflow_dispatch (lib/github-actions-dispatch.ts). Unitaria, sin red real
// (fetch mockeado vía node:test) y sin DB - la integración real de este
// módulo dentro de la ruta HTTP (incluyendo qué pasa con
// pipeline.refresh_runs) vive en
// test/pipeline/data-refresh-dispatch.integration.test.ts.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { dispatchDataRefreshWorkflow } from "../../lib/github-actions-dispatch.ts";

const DISPATCH_ENV_VARS = [
  "GITHUB_ACTIONS_DISPATCH_TOKEN",
  "GITHUB_ACTIONS_DISPATCH_OWNER",
  "GITHUB_ACTIONS_DISPATCH_REPO",
  "GITHUB_ACTIONS_DISPATCH_WORKFLOW",
  "GITHUB_ACTIONS_DISPATCH_REF"
];

function clearDispatchEnv() {
  for (const name of DISPATCH_ENV_VARS) delete process.env[name];
}

function setFullDispatchEnv() {
  clearDispatchEnv();
  process.env.GITHUB_ACTIONS_DISPATCH_TOKEN = "test-token-never-a-real-secret";
  process.env.GITHUB_ACTIONS_DISPATCH_OWNER = "eyg-test-org";
  process.env.GITHUB_ACTIONS_DISPATCH_REPO = "eyg-nexus-production";
}

const SAMPLE_PARAMS = {
  environment: "STAGING",
  mode: "INCREMENTAL",
  confirmed: false,
  reason: "prueba unitaria",
  refreshRunId: "11111111-1111-1111-1111-111111111111"
};

test("dispatchDataRefreshWorkflow(): configuración completa + GitHub responde 204 -> ok:true, exactamente un fetch, URL/inputs/refresh_run_id correctos", async () => {
  setFullDispatchEnv();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(null, { status: 204 });
  });

  try {
    const result = await dispatchDataRefreshWorkflow(SAMPLE_PARAMS);
    assert.deepEqual(result, { ok: true });
    assert.equal(calls.length, 1, "debe llamar fetch exactamente una vez");

    const { url, init } = calls[0];
    assert.equal(
      url,
      "https://api.github.com/repos/eyg-test-org/eyg-nexus-production/actions/workflows/data-refresh.yml/dispatches"
    );
    assert.equal(init.method, "POST");
    const headers = init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer test-token-never-a-real-secret");

    const body = JSON.parse(init.body as string);
    assert.equal(body.ref, "main");
    assert.equal(body.inputs.refresh_run_id, SAMPLE_PARAMS.refreshRunId);
    assert.equal(body.inputs.environment, "STAGING");
    assert.equal(body.inputs.mode, "INCREMENTAL");
  } finally {
    mock.restoreAll();
    clearDispatchEnv();
  }
});

test("dispatchDataRefreshWorkflow(): GITHUB_ACTIONS_DISPATCH_WORKFLOW/REF configurables -> se usan en vez de los valores por defecto", async () => {
  setFullDispatchEnv();
  process.env.GITHUB_ACTIONS_DISPATCH_WORKFLOW = "custom-refresh.yml";
  process.env.GITHUB_ACTIONS_DISPATCH_REF = "predeploy/v3-refresh-guards";
  const calls: string[] = [];
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push(url);
    assert.equal(JSON.parse(init.body as string).ref, "predeploy/v3-refresh-guards");
    return new Response(null, { status: 204 });
  });

  try {
    const result = await dispatchDataRefreshWorkflow(SAMPLE_PARAMS);
    assert.equal(result.ok, true);
    assert.match(calls[0], /\/workflows\/custom-refresh\.yml\/dispatches$/);
  } finally {
    mock.restoreAll();
    clearDispatchEnv();
  }
});

test("dispatchDataRefreshWorkflow(): falta GITHUB_ACTIONS_DISPATCH_TOKEN -> ok:false, falla cerrado SIN llamar fetch", async () => {
  clearDispatchEnv();
  process.env.GITHUB_ACTIONS_DISPATCH_OWNER = "eyg-test-org";
  process.env.GITHUB_ACTIONS_DISPATCH_REPO = "eyg-nexus-production";
  let fetchCalled = false;
  mock.method(globalThis, "fetch", async () => {
    fetchCalled = true;
    return new Response(null, { status: 204 });
  });

  try {
    const result = await dispatchDataRefreshWorkflow(SAMPLE_PARAMS);
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /GITHUB_ACTIONS_DISPATCH_TOKEN/);
    assert.equal(fetchCalled, false, "un token faltante nunca debe intentar la llamada HTTP");
  } finally {
    mock.restoreAll();
    clearDispatchEnv();
  }
});

test("dispatchDataRefreshWorkflow(): faltan owner y repo -> ok:false, reason lista AMBOS nombres de variable", async () => {
  clearDispatchEnv();
  process.env.GITHUB_ACTIONS_DISPATCH_TOKEN = "test-token-never-a-real-secret";

  const result = await dispatchDataRefreshWorkflow(SAMPLE_PARAMS);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /GITHUB_ACTIONS_DISPATCH_OWNER/);
  assert.match(result.reason ?? "", /GITHUB_ACTIONS_DISPATCH_REPO/);
  clearDispatchEnv();
});

test("dispatchDataRefreshWorkflow(): GitHub responde con error (422) -> ok:false, nunca lanza, reason incluye el status", async () => {
  setFullDispatchEnv();
  mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ message: "Workflow does not have workflow_dispatch trigger" }), { status: 422 })
  );

  try {
    const result = await dispatchDataRefreshWorkflow(SAMPLE_PARAMS);
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /422/);
  } finally {
    mock.restoreAll();
    clearDispatchEnv();
  }
});

test("dispatchDataRefreshWorkflow(): fetch rechaza (falla de red) -> ok:false, nunca lanza, reason incluye el motivo de red", async () => {
  setFullDispatchEnv();
  mock.method(globalThis, "fetch", async () => {
    throw new Error("network unreachable");
  });

  try {
    const result = await dispatchDataRefreshWorkflow(SAMPLE_PARAMS);
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /network unreachable/);
  } finally {
    mock.restoreAll();
    clearDispatchEnv();
  }
});

test("dispatchDataRefreshWorkflow(): el token nunca aparece en el resultado devuelto (ni en éxito ni en error)", async () => {
  setFullDispatchEnv();
  const secret = process.env.GITHUB_ACTIONS_DISPATCH_TOKEN as string;

  mock.method(globalThis, "fetch", async () => new Response("token leak probe", { status: 500 }));
  try {
    const result = await dispatchDataRefreshWorkflow(SAMPLE_PARAMS);
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  } finally {
    mock.restoreAll();
    clearDispatchEnv();
  }
});
