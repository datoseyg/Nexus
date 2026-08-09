import { test } from "node:test";
import assert from "node:assert/strict";
import { getFieldbeatOpenConfig, isFieldbeatOpenConfigured, buildFieldbeatExternalUrl } from "../../lib/fieldbeat-open-url.ts";

const ENV_KEYS = ["FIELDBEAT_FLEET", "FIELDBEAT_REPORT_TOKEN"] as const;

function withEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
  try {
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test("getFieldbeatOpenConfig: null cuando falta FIELDBEAT_FLEET", () => {
  withEnv({ FIELDBEAT_REPORT_TOKEN: "sentinel-token" }, () => {
    assert.equal(getFieldbeatOpenConfig(), null);
  });
});

test("getFieldbeatOpenConfig: null cuando falta FIELDBEAT_REPORT_TOKEN", () => {
  withEnv({ FIELDBEAT_FLEET: "sentinel-fleet" }, () => {
    assert.equal(getFieldbeatOpenConfig(), null);
  });
});

test("getFieldbeatOpenConfig: null cuando faltan ambos", () => {
  withEnv({}, () => {
    assert.equal(getFieldbeatOpenConfig(), null);
  });
});

test("getFieldbeatOpenConfig: null cuando alguno está vacío (string vacío no cuenta como configurado)", () => {
  withEnv({ FIELDBEAT_FLEET: "", FIELDBEAT_REPORT_TOKEN: "sentinel-token" }, () => {
    assert.equal(getFieldbeatOpenConfig(), null);
  });
});

test("getFieldbeatOpenConfig: {fleet,token} cuando ambos están presentes", () => {
  withEnv({ FIELDBEAT_FLEET: "sentinel-fleet", FIELDBEAT_REPORT_TOKEN: "sentinel-token" }, () => {
    assert.deepEqual(getFieldbeatOpenConfig(), { fleet: "sentinel-fleet", token: "sentinel-token" });
  });
});

test("isFieldbeatOpenConfigured: refleja getFieldbeatOpenConfig sin exponer sus valores", () => {
  withEnv({}, () => assert.equal(isFieldbeatOpenConfigured(), false));
  withEnv({ FIELDBEAT_FLEET: "f", FIELDBEAT_REPORT_TOKEN: "t" }, () => assert.equal(isFieldbeatOpenConfigured(), true));
});

test("buildFieldbeatExternalUrl: host/protocolo/path fijos, nunca controlables por el llamador", () => {
  const url = buildFieldbeatExternalUrl({ fleet: "sentinel-fleet", token: "sentinel-token", taskId: "900005" });
  const parsed = new URL(url);
  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.hostname, "teams.fieldbeat.com");
  assert.equal(parsed.pathname, "/");
  assert.equal(parsed.hash, "#/reportes/tarea?fleet=sentinel-fleet&task_id=900005&token=sentinel-token");
});

test("buildFieldbeatExternalUrl: fleet/token/taskId con caracteres especiales quedan codificados, nunca inyectan un parámetro nuevo", () => {
  const url = buildFieldbeatExternalUrl({ fleet: "f&url=evil.example", token: "t#fake=1", taskId: "900005" });
  assert.doesNotMatch(url, /url=evil\.example(?!%)/, "el '&' del fleet no debe partir un parámetro nuevo sin codificar");
  assert.ok(url.includes("fleet=f%26url%3Devil.example"), "el fleet completo debe viajar codificado como UN solo valor");
  assert.ok(url.includes(encodeURIComponent("t#fake=1")) || url.includes("token=t%23fake%3D1"));
});

test("buildFieldbeatExternalUrl: siempre exactamente los 3 parámetros esperados, nunca más ni menos", () => {
  const url = buildFieldbeatExternalUrl({ fleet: "f", token: "t", taskId: "1" });
  const hash = url.split("#")[1];
  const query = hash.split("?")[1];
  const params = new URLSearchParams(query);
  assert.deepEqual([...params.keys()].sort(), ["fleet", "task_id", "token"]);
});
