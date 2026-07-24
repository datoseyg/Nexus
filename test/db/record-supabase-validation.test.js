import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

async function loadRecorder() {
  try {
    return await import("../../src/db/record-supabase-validation.js");
  } catch {
    assert.fail("falta src/db/record-supabase-validation.js");
  }
}

const runId = "00000000-0000-0000-0000-000000000001";
const localTarget = "localhost:55480/nexus_bi_dev_local_test";
const summary = {
  validation_status: "PASSED",
  provenance: { sync_run_id: runId, target: localTarget },
  checks: {},
  objects: []
};

function summaryFor(target) {
  return { ...summary, provenance: { sync_run_id: runId, target } };
}

test("registro opcional exige confirmación antes de ejecutar UPDATE", async () => {
  const { recordValidationResult } = await loadRecorder();
  let executions = 0;
  await assert.rejects(
    recordValidationResult({
      connectionString: "postgresql://u:p@localhost:5432/nexus_shared",
      runId,
      summary: summaryFor("localhost:5432/nexus_shared"),
      executeUpdate: async () => { executions++; }
    }),
    /CONFIRM_WRITE_TARGET/
  );
  assert.equal(executions, 0);
});

test("host Supabase sin doble confirmación permanece bloqueado", async () => {
  const { recordValidationResult } = await loadRecorder();
  delete process.env.CONFIRM_WRITE_TARGET;
  delete process.env.CONFIRM_PROTECTED_WRITE_TARGET;
  let executions = 0;
  await assert.rejects(
    recordValidationResult({
      connectionString: "postgresql://u:p@aws-0-test.pooler.supabase.com:6543/nexus",
      runId,
      summary: summaryFor("aws-0-test.pooler.supabase.com:6543/nexus"),
      executeUpdate: async () => { executions++; }
    }),
    /AMBAS CONFIRM_WRITE_TARGET|entorno protegido/
  );
  assert.equal(executions, 0);
});

test("target local desechable autorizado puede registrar el resultado", async () => {
  const { recordValidationResult } = await loadRecorder();
  let received = null;
  const result = await recordValidationResult({
    connectionString: "postgresql://postgres:local@localhost:55480/nexus_bi_dev_local_test",
    runId,
    summary,
    executeUpdate: async values => {
      received = values;
      return { rowCount: 1 };
    }
  });
  assert.equal(result.recorded, true);
  assert.equal(received.validationStatus, "PASSED");
});

test("rechaza un resumen cuyo run_id pertenece a otra migración", async () => {
  const { recordValidationResult } = await loadRecorder();
  let executions = 0;
  await assert.rejects(
    recordValidationResult({
      connectionString: "postgresql://postgres:local@localhost:55480/nexus_bi_dev_local_test",
      runId,
      summary: {
        ...summary,
        provenance: { ...summary.provenance, sync_run_id: "00000000-0000-0000-0000-000000000002" }
      },
      executeUpdate: async () => { executions++; }
    }),
    /run_id del resumen no coincide/
  );
  assert.equal(executions, 0);
});

test("rechaza un resumen validado contra otro destino", async () => {
  const { recordValidationResult } = await loadRecorder();
  let executions = 0;
  await assert.rejects(
    recordValidationResult({
      connectionString: "postgresql://postgres:local@localhost:55480/nexus_bi_dev_local_test",
      runId,
      summary: {
        ...summary,
        provenance: { ...summary.provenance, target: "localhost:55480/otra_base_disposable" }
      },
      executeUpdate: async () => { executions++; }
    }),
    /destino del resumen no coincide/
  );
  assert.equal(executions, 0);
});

test("rechaza resúmenes legacy sin procedencia enlazada", async () => {
  const { recordValidationResult } = await loadRecorder();
  await assert.rejects(
    recordValidationResult({
      connectionString: "postgresql://postgres:local@localhost:55480/nexus_bi_dev_local_test",
      runId,
      summary: { validation_status: "PASSED", checks: {}, objects: [] },
      executeUpdate: async () => ({ rowCount: 1 })
    }),
    /procedencia/
  );
});

test("record-validation es comando separado y no forma parte de db:pg:build", async () => {
  const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
  assert.equal(packageJson.scripts["db:pg:record-validation"], "node src/db/record-supabase-validation.js");
  assert.doesNotMatch(packageJson.scripts["db:pg:build"], /record-validation/);
});
