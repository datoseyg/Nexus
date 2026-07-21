import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDryRunReport } from "../../src/holidays/dry-run-report.js";
import { validateBundle, SCHEMA_VERSION } from "../../src/holidays/bundle-validator.js";

function bundleFixture() {
  return {
    schema_version: SCHEMA_VERSION,
    jurisdiction: "CL",
    coverage_start: "2026-01-01",
    coverage_end_exclusive: "2027-01-01",
    sources: [{ source_id: "src-1", authority: "Gobierno de Chile", title: "Calendario oficial", url: "https://www.gob.cl/x", accessed_at: "2026-07-15" }],
    events: [
      { local_date: "2026-01-01", holiday_name: "Año Nuevo", holiday_type: "FIXED_DATE", is_irrenunciable: true, source_ids: ["src-1"] },
      { local_date: "2026-09-18", holiday_name: "Independencia Nacional", holiday_type: "FIXED_DATE", source_ids: ["src-1"] },
      { local_date: "2026-09-18", holiday_name: "Feriado Regional Ejemplo", holiday_type: "REGIONAL", source_ids: ["src-1"] }
    ]
  };
}

test("buildDryRunReport es puro: no escribe nada, solo arma el objeto", () => {
  const bundle = bundleFixture();
  const validation = validateBundle(bundle);
  const report = buildDryRunReport({ filePath: "x.json", sha256: "abc123", bundle, validation, alreadyImported: { isDuplicate: false, priorImportId: null }, dbPeekAvailable: false });

  assert.equal(report.importMode, "dry-run");
  assert.equal(report.rows.read, 3);
  assert.equal(report.rows.accepted, 3);
  assert.equal(report.rows.errored, 0);
  assert.equal(report.coverage.start, "2026-01-01");
  assert.equal(report.countsByType.FIXED_DATE, 2);
  assert.equal(report.countsByType.REGIONAL, 1);
});

test("reporta correctamente las fechas con eventos coincidentes", () => {
  const bundle = bundleFixture();
  const validation = validateBundle(bundle);
  const report = buildDryRunReport({ filePath: "x.json", sha256: "abc123", bundle, validation, alreadyImported: null, dbPeekAvailable: false });

  assert.equal(report.coincidentDates.length, 1);
  assert.equal(report.coincidentDates[0].localDate, "2026-09-18");
  assert.equal(report.coincidentDates[0].sourceEventKeys.length, 2);
});

test("bundle inválido: rows.errored refleja el total, rows.accepted queda en 0", () => {
  const bundle = bundleFixture();
  bundle.events[0].source_ids = ["src-inexistente"];
  const validation = validateBundle(bundle);
  const report = buildDryRunReport({ filePath: "x.json", sha256: "abc123", bundle, validation, alreadyImported: null, dbPeekAvailable: false });

  assert.equal(validation.ok, false);
  assert.equal(report.rows.accepted, 0);
  assert.equal(report.rows.errored, 3);
  assert.ok(report.errors.length > 0);
});
