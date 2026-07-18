// ETAPA 6.5.1.1 - TDD de los casos del encargo NO cubiertos ya por los 8
// subtests de test/contracts/db-writer.integration.test.js (apply inicial,
// idempotencia, UNCHANGED, SPA->SUPERSEDE, FATAL_BACKDATED, retry tras
// FAILED, advisory lock, grants). Contra Postgres 16 DESECHABLE -nunca
// Supabase productivo, nunca nexus-afterhours-realdata2. Se salta entera si
// CONTRACTS_TEST_DATABASE_URL no está seteada.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import pg from "pg";
import { assertDisposableTarget, printConnectionPreflight } from "../../src/lib/db-safety.js";
import { resolveEquipmentContract } from "../../src/working-hours/contract-resolver.js";

const TEST_DB_URL = process.env.CONTRACTS_TEST_DATABASE_URL;
const TEST_RUN_ID = process.env.CONTRACTS_TEST_RUN_ID;
const SUITE_ID = "contracts-versioning-lifecycle-test";

if (TEST_DB_URL) {
  process.env.SUPABASE_DB_URL_DIRECT = TEST_DB_URL;
}

const { Pool } = pg;
let adminPool;
let applyContracts;

function makeFixtureCsv(overrides = {}) {
  const base = {
    cliente: "Cliente Lifecycle",
    abreviacion: "CL",
    equipo: "ModeloY",
    serie: "777001",
    anio: "mar-2019",
    estado: "Vigente (Ren. Automática) (E&G)",
    spa: "Gold (Incluye todos los repuestos)",
    lunVie: "Sí",
    sabDom: "No",
    soporte: "Remoto",
    horarios: "24/7",
    hwRefresh: "No",
    updates: "Sí",
    upgrades: "Sí",
    repuestos: "Todo Incluído",
    qmant: "2",
    notas: ""
  };
  const f = { ...base, ...overrides };
  const header = "Cliente,Abreviación,Equipo,S-N,Año Instalación,Estado Contrato,SPA con Elekta,Lun - Vie,Sab - Dom,Soporte Elekta,Horarios de Atención,HW Refresh,UpDates,UpGrades,Situación Repuestos,Q Mant Prev x Año,Notas,,,,,,,Variables(no considerar para analisis)";
  const row = `${f.cliente},${f.abreviacion},${f.equipo},${f.serie},${f.anio},${f.estado},${f.spa},${f.lunVie},${f.sabDom},${f.soporte},${f.horarios},${f.hwRefresh},${f.updates},${f.upgrades},${f.repuestos},${f.qmant},${f.notas},,,,,,,`;
  return `${header}\n${row}\n`;
}

async function writeFixture(name, content) {
  const dir = "test/contracts/.tmp-fixtures-lifecycle";
  await fs.mkdir(dir, { recursive: true });
  const filePath = `${dir}/${name}`;
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

test("ETAPA 6.5.1.1 - lifecycle de versiones (requiere CONTRACTS_TEST_DATABASE_URL)", { skip: !TEST_DB_URL }, async t => {
  before(async () => {
    if (!TEST_RUN_ID) {
      throw new Error("Falta CONTRACTS_TEST_RUN_ID -requerido junto con CONTRACTS_TEST_DATABASE_URL.");
    }
    printConnectionPreflight(TEST_DB_URL, { environment: "integration-test", applicationName: `${SUITE_ID}:${TEST_RUN_ID}` });
    adminPool = new Pool({ connectionString: TEST_DB_URL, application_name: `${SUITE_ID}:${TEST_RUN_ID}` });
    await assertDisposableTarget(adminPool, { expectedRunId: TEST_RUN_ID, expectedSuiteId: SUITE_ID });

    await adminPool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    await adminPool.query("CREATE SCHEMA IF NOT EXISTS manual_review");
    await adminPool.query("CREATE SCHEMA IF NOT EXISTS processed");
    await adminPool.query(`
      CREATE TABLE IF NOT EXISTS processed.fieldbeat_equipments (
        equipment_key TEXT, equipment_uuid TEXT, internal_id TEXT, client_key TEXT, equipment_type TEXT, source_system TEXT, updated_at TIMESTAMPTZ
      )
    `);
    await adminPool.query(`
      CREATE TABLE IF NOT EXISTS processed.fieldbeat_clients (
        client_key TEXT, client_name TEXT, rut TEXT, fieldbeat_client_name TEXT, address_raw TEXT, city TEXT, commune TEXT, country TEXT, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION, updated_at TIMESTAMPTZ
      )
    `);
    await adminPool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'nexus_app') THEN
          CREATE ROLE nexus_app WITH LOGIN PASSWORD 'test';
        END IF;
      END $$;
    `);
    await adminPool.query(await fs.readFile("sql/070_config.sql", "utf8"));
    await adminPool.query(await fs.readFile("sql/084_contract_valid_from_correction.sql", "utf8"));
    await adminPool.query(await fs.readFile("sql/085_contract_version_revision_uniqueness.sql", "utf8"));

    await adminPool.query(
      `INSERT INTO processed.fieldbeat_equipments (equipment_key, equipment_uuid, internal_id, client_key) VALUES ('K-LC','u-lc','Linac-777001','C-LC')`
    );
    await adminPool.query(`INSERT INTO processed.fieldbeat_clients (client_key, client_name) VALUES ('C-LC','Cliente Lifecycle')`);

    applyContracts = (await import("../../src/contracts/db-writer.js")).applyContracts;
  });

  after(async () => {
    await adminPool.query("DROP SCHEMA IF EXISTS config CASCADE");
    await adminPool.query("DROP TABLE IF EXISTS manual_review.contract_data_issues CASCADE");
    await adminPool.query("DROP SCHEMA IF EXISTS processed CASCADE");
    await adminPool.end();
  });

  await t.test("Caso 4: Gold -> Silver -> Bronze -las 3 se conservan, exactamente 1 is_current=true", async () => {
    await applyContracts({ file: await writeFixture("c4-gold.csv", makeFixtureCsv()), effectiveDate: "2026-01-01" });
    await applyContracts({ file: await writeFixture("c4-silver.csv", makeFixtureCsv({ spa: "Silver (Sólo Soporte)" })), effectiveDate: "2026-02-01" });
    await applyContracts({ file: await writeFixture("c4-bronze.csv", makeFixtureCsv({ spa: "Sin SPA (Fuera registros Elekta)" })), effectiveDate: "2026-03-01" });

    const versions = await adminPool.query(
      "SELECT spa_tier_code, is_current, superseded_at, valid_from FROM config.contract_equipment_versions WHERE equipment_key = 'SN:777001' ORDER BY contract_version_id"
    );
    assert.equal(versions.rows.length, 3, "las 3 revisiones se conservan -nunca se borra historial");
    assert.deepEqual(versions.rows.map(r => r.spa_tier_code), ["GOLD", "SILVER", "NO_SPA"]);
    assert.deepEqual(versions.rows.map(r => r.is_current), [false, false, true]);
    assert.ok(versions.rows[0].superseded_at && versions.rows[1].superseded_at, "Gold y Silver quedan marcadas superseded_at");
    assert.equal(versions.rows[2].superseded_at, null, "Bronze (autoritativa) no tiene superseded_at");

    const allSameValidFrom = versions.rows.every(r => r.valid_from === versions.rows[0].valid_from);
    assert.ok(allSameValidFrom, "las 3 comparten la misma vigencia de negocio (mismo valid_from) -solo el registro se corrigió 2 veces");

    const currentCount = await adminPool.query(
      "SELECT count(*) AS n FROM config.contract_equipment_versions WHERE equipment_key = 'SN:777001' AND is_current = true"
    );
    assert.equal(Number(currentCount.rows[0].n), 1, "autoridad única: exactamente una revisión is_current=true");
  });

  await t.test("Caso 5: forzar 2 revisiones is_current=true para el mismo (equipment_key, valid_from) -> falla por constraint (sql/085)", async () => {
    const current = await adminPool.query(
      "SELECT contract_version_id, valid_from FROM config.contract_equipment_versions WHERE equipment_key = 'SN:777001' AND is_current = true"
    );
    assert.equal(current.rows.length, 1);

    // Clona manualmente la fila is_current=true, intentando dejarla TAMBIÉN
    // is_current=true -mismo equipment_key, mismo valid_from que la
    // existente. Debe rechazarse por contract_equipment_versions_current_per_period_uidx.
    await assert.rejects(
      () => adminPool.query(
        `INSERT INTO config.contract_equipment_versions
           (equipment_key, client_name_canonical, client_name_raw, equipment_model,
            installation_date_precision, contract_status_code, spa_tier_code,
            support_mode_code, parts_coverage_code, hw_refresh_code, updates_code, upgrades_code,
            warranty_end_date_source, valid_from, valid_from_basis, valid_from_precision,
            valid_to, is_current, normalization_status,
            source_import_id, source_row_number, source_row_hash, contract_fingerprint)
         SELECT equipment_key, client_name_canonical, client_name_raw, equipment_model,
                installation_date_precision, contract_status_code, spa_tier_code,
                support_mode_code, parts_coverage_code, hw_refresh_code, updates_code, upgrades_code,
                warranty_end_date_source, valid_from, valid_from_basis, valid_from_precision,
                NULL, true, normalization_status,
                source_import_id, source_row_number, source_row_hash, 'fingerprint-forzado-distinto'
         FROM config.contract_equipment_versions WHERE contract_version_id = $1`,
        [current.rows[0].contract_version_id]
      ),
      /duplicate key|contract_equipment_versions_current_per_period_uidx/
    );

    const stillOne = await adminPool.query(
      "SELECT count(*) AS n FROM config.contract_equipment_versions WHERE equipment_key = 'SN:777001' AND is_current = true"
    );
    assert.equal(Number(stillOne.rows[0].n), 1, "el intento rechazado no dejó una segunda fila is_current=true");
  });

  await t.test("Caso 6 (corregido, 2ª ronda): Gold -> Silver -> Gold -reversión legítima, NO bloqueada por un UNIQUE histórico de fingerprint (defecto 2 corregido)", async () => {
    await applyContracts({ file: await writeFixture("c6-gold1.csv", makeFixtureCsv({ serie: "777006" })), effectiveDate: "2026-01-01" });
    await applyContracts({ file: await writeFixture("c6-silver.csv", makeFixtureCsv({ serie: "777006", spa: "Silver (Sólo Soporte)" })), effectiveDate: "2026-02-01" });
    // Reversión: vuelve al MISMO contenido normativo que la 1ª revisión
    // (mismo fingerprint que Gold) -evento de registro NUEVO, no debe
    // fallar por ningún UNIQUE histórico (la 1ª versión de sql/085 sí lo
    // hacía -defecto 2, corregido). notas distinta a propósito -mismo
    // patrón que "fila sin cambios (mismo fingerprint) -> UNCHANGED" del
    // archivo principal: el archivo debe tener un SHA-256 distinto al de
    // c6-gold1.csv (si no, applyContracts() lo trata como "mismo archivo ya
    // importado" -alreadyImported=true, results=[]- ANTES de siquiera
    // comparar fingerprints, sin relación con la reversión que este test
    // quiere probar). El fingerprint normativo (spa/estado/etc.) sí coincide
    // con c6-gold1.csv -notas nunca forma parte del fingerprint.
    const r3 = await applyContracts({ file: await writeFixture("c6-gold2.csv", makeFixtureCsv({ serie: "777006", notas: "vuelta a Gold" })), effectiveDate: "2026-03-01" });
    assert.equal(r3.results[0].versionAction, "SUPERSEDE", "la 2ª revisión Gold es un evento de registro nuevo -SUPERSEDE, no UNCHANGED, aunque el fingerprint coincida con una revisión histórica (no la actual)");

    const versions = await adminPool.query(
      "SELECT spa_tier_code, is_current, superseded_at, valid_from, contract_fingerprint FROM config.contract_equipment_versions WHERE equipment_key = 'SN:777006' ORDER BY contract_version_id"
    );
    assert.equal(versions.rows.length, 3, "las 3 revisiones se conservan, incluida la reversión");
    assert.deepEqual(versions.rows.map(r => r.spa_tier_code), ["GOLD", "SILVER", "GOLD"]);
    assert.deepEqual(versions.rows.map(r => r.is_current), [false, false, true], "1ª Gold superseded, Silver superseded, 2ª Gold current");
    assert.ok(versions.rows[0].superseded_at, "1ª Gold marcada superseded_at");
    assert.ok(versions.rows[1].superseded_at, "Silver marcada superseded_at");
    assert.equal(versions.rows[2].superseded_at, null, "2ª Gold (autoritativa) sin superseded_at");
    assert.equal(versions.rows[0].contract_fingerprint, versions.rows[2].contract_fingerprint, "mismo contenido normativo entre 1ª y 2ª Gold -son el mismo fingerprint, pero filas DISTINTAS (eventos de registro distintos)");

    const allSameValidFrom = versions.rows.every(r => r.valid_from === versions.rows[0].valid_from);
    assert.ok(allSameValidFrom, "valid_from sin alterar en ninguna de las 3 -misma vigencia de negocio todo el tiempo");

    const currentCount = await adminPool.query(
      "SELECT count(*) AS n FROM config.contract_equipment_versions WHERE equipment_key = 'SN:777006' AND is_current = true"
    );
    assert.equal(Number(currentCount.rows[0].n), 1, "autoridad única: exactamente una revisión is_current=true tras la reversión");
  });

  await t.test("Caso 6bis: un duplicado exacto de (equipment_key, valid_from, contract_fingerprint) como fila NO-autoritativa YA NO está bloqueado a nivel de BD (defecto 2) -la idempotencia real vive en versioning.js, contra la revisión actual únicamente", async () => {
    const currentRow = (await adminPool.query(
      "SELECT * FROM config.contract_equipment_versions WHERE equipment_key = 'SN:777006' AND is_current = true"
    )).rows[0];

    // Mismo fingerprint que la revisión is_current=true, pero insertada
    // DIRECTAMENTE como is_current=false (historial) -ya no existe ningún
    // UNIQUE de BD que la bloquee (el de la 1ª versión de sql/085 sí lo
    // hacía, y por eso bloqueaba Gold->Silver->Gold). No pasa por
    // versioning.js -este test confirma la ausencia del constraint, no el
    // comportamiento normal de --apply (cubierto por Caso 6 arriba y por
    // "fila sin cambios (mismo fingerprint) -> UNCHANGED" del archivo
    // principal).
    await assert.doesNotReject(() =>
      adminPool.query(
        `INSERT INTO config.contract_equipment_versions
           (equipment_key, client_name_canonical, client_name_raw, equipment_model,
            installation_date_precision, contract_status_code, spa_tier_code,
            support_mode_code, parts_coverage_code, hw_refresh_code, updates_code, upgrades_code,
            warranty_end_date_source, valid_from, valid_from_basis, valid_from_precision,
            valid_to, is_current, superseded_at, normalization_status,
            source_import_id, source_row_number, source_row_hash, contract_fingerprint)
         VALUES
           ($1,$2,$3,$4, $5,$6,$7, $8,$9,$10,$11,$12, $13,$14,$15,$16, NULL, false, now(), $17, $18,$19,$20, $21)`,
        [
          currentRow.equipment_key, currentRow.client_name_canonical, currentRow.client_name_raw, currentRow.equipment_model,
          currentRow.installation_date_precision, currentRow.contract_status_code, currentRow.spa_tier_code,
          currentRow.support_mode_code, currentRow.parts_coverage_code, currentRow.hw_refresh_code, currentRow.updates_code, currentRow.upgrades_code,
          currentRow.warranty_end_date_source, currentRow.valid_from, currentRow.valid_from_basis, currentRow.valid_from_precision,
          currentRow.normalization_status,
          currentRow.source_import_id, currentRow.source_row_number, currentRow.source_row_hash, currentRow.contract_fingerprint
        ]
      )
    );

    // La AUTORIDAD única (is_current=true) sigue intacta -eso nunca
    // dependió del constraint eliminado.
    const currentCount = await adminPool.query(
      "SELECT count(*) AS n FROM config.contract_equipment_versions WHERE equipment_key = 'SN:777006' AND is_current = true"
    );
    assert.equal(Number(currentCount.rows[0].n), 1, "autoridad única no depende del UNIQUE histórico eliminado");
  });

  await t.test("Caso 7: nueva vigencia contractual (valid_from DISTINTO) -> NEW, no SUPERSEDE; el período anterior queda intacto", async () => {
    // Mismo equipment_key lógico pero un equipo NUEVO (serie distinta) con
    // fecha de instalación muy anterior, simulando una reinstalación /
    // renegociación desde cero con un valid_from real distinto -usamos un
    // equipment_key propio para no interferir con SN:777001 de los casos
    // previos, y verificamos que dos vigencias de negocio bien distintas
    // para EL MISMO equipo (777001-b) coexisten como autoritativas.
    await adminPool.query(
      `INSERT INTO processed.fieldbeat_equipments (equipment_key, equipment_uuid, internal_id, client_key) VALUES ('K-LC2','u-lc2','Linac-777002','C-LC')`
    );

    await applyContracts({ file: await writeFixture("c7-period1.csv", makeFixtureCsv({ serie: "777002", anio: "ene-2015" })), effectiveDate: "2026-01-01" });
    await applyContracts({ file: await writeFixture("c7-period2.csv", makeFixtureCsv({ serie: "777002", anio: "jun-2022", spa: "Silver (Sólo Soporte)" })), effectiveDate: "2026-02-01" });

    const versions = await adminPool.query(
      "SELECT valid_from, is_current, superseded_at, spa_tier_code FROM config.contract_equipment_versions WHERE equipment_key = 'SN:777002' ORDER BY valid_from"
    );
    assert.equal(versions.rows.length, 2, "dos vigencias de negocio distintas, ambas conservadas");
    // La vigencia 2015 NO fue tocada por la importación de la vigencia 2022
    // -sigue is_current=true y sin superseded_at, porque son períodos
    // DISTINTOS, no una corrección del mismo período (invariante 5.7).
    assert.equal(versions.rows[0].is_current, true, "el período 2015 sigue autoritativo -una nueva vigencia no lo reemplaza");
    assert.equal(versions.rows[0].superseded_at, null);
    assert.equal(versions.rows[1].is_current, true, "el período 2022 también es autoritativo, en lo suyo");
    assert.equal(versions.rows[1].superseded_at, null);
    assert.notEqual(versions.rows[0].valid_from, versions.rows[1].valid_from);
  });

  await t.test("Caso 9: resolución temporal -el resolver usa EXCLUSIVAMENTE la revisión autoritativa correspondiente, nunca una superseded que comparte valid_from", async () => {
    // SN:777001 (Caso 4) terminó con 3 revisiones (Gold/Silver/Bronze),
    // todas MISMO valid_from, solo Bronze is_current=true. Simula
    // exactamente la consulta real de src/working-hours/db-writer.js
    // (WHERE is_current = true) y confirma que resolveEquipmentContract()
    // -función pura, sin conocimiento de is_current- nunca ve las
    // revisiones supersedidas como candidatas.
    const authoritativeOnly = await adminPool.query(
      `SELECT contract_version_id, valid_from, valid_to, contract_status_code, spa_tier_code
       FROM config.contract_equipment_versions
       WHERE equipment_key = 'SN:777001' AND is_current = true
       ORDER BY valid_from DESC NULLS LAST`
    );
    assert.equal(authoritativeOnly.rows.length, 1, "la consulta scoped a is_current=true expone UNA sola revisión, nunca las 3");

    const versionsForResolver = authoritativeOnly.rows.map(r => ({
      contractVersionId: r.contract_version_id, validFrom: r.valid_from, validTo: r.valid_to, contractStatusCode: r.contract_status_code
    }));
    const resolved = resolveEquipmentContract({
      fieldbeatEquipmentKey: "EQ-LC",
      taskLocalDate: "2026-06-01",
      match: { matchStatus: "MATCHED", matchMethod: "SERIAL_SUFFIX", contractEquipmentKey: "SN:777001" },
      versions: versionsForResolver,
      scheduleByVersionId: new Map(),
      windowsByScheduleId: new Map()
    });
    assert.equal(resolved.contractVersionId, authoritativeOnly.rows[0].contract_version_id, "resuelve a la única revisión autoritativa (Bronze), nunca a Gold/Silver supersedidas");

    // Contraprueba: SIN el filtro is_current (comportamiento viejo,
    // pre-6.5.1.1), las 3 revisiones comparten el mismo valid_from con
    // valid_to=NULL -el resolver vería 3 candidatas simultáneamente
    // "vigentes" para la misma fecha, una ambigüedad no determinista que la
    // consulta corregida evita estructuralmente.
    const allRevisions = await adminPool.query(
      `SELECT contract_version_id, valid_from, valid_to, contract_status_code
       FROM config.contract_equipment_versions WHERE equipment_key = 'SN:777001'`
    );
    const ambiguousCandidates = allRevisions.rows.filter(r =>
      r.valid_from !== null && "2026-06-01" >= r.valid_from && (r.valid_to === null || "2026-06-01" < r.valid_to)
    );
    assert.equal(ambiguousCandidates.length, 3, "documenta la ambigüedad real que existiría sin el filtro is_current -confirma por qué el filtro es obligatorio, no opcional");
  });

  await t.test("Caso 10: concurrencia -dos transacciones intentando ser is_current=true para el mismo período, la segunda debe fallar (defensa en profundidad del índice, más allá del advisory lock por archivo)", async () => {
    const clientA = await adminPool.connect();
    const clientB = await adminPool.connect();
    try {
      const currentRow = (await adminPool.query(
        "SELECT * FROM config.contract_equipment_versions WHERE equipment_key = 'SN:777001' AND is_current = true"
      )).rows[0];

      // Simula 2 "corridas" de importación DISTINTAS (no protegidas por el
      // advisory lock de sourceSha256, que solo serializa reimportaciones
      // del MISMO archivo) tratando de introducir cada una su propia
      // revisión autoritativa para el mismo (equipment_key, valid_from) sin
      // pasar por versioning.js -exactamente el escenario que el índice de
      // sql/085 debe bloquear estructuralmente, no solo el advisory lock.
      await clientA.query("BEGIN");
      await clientB.query("BEGIN");

      await clientA.query(
        `UPDATE config.contract_equipment_versions SET is_current = false, superseded_at = now() WHERE contract_version_id = $1`,
        [currentRow.contract_version_id]
      );

      const insertSql = `
        INSERT INTO config.contract_equipment_versions
          (equipment_key, client_name_canonical, client_name_raw, equipment_model,
           installation_date_precision, contract_status_code, spa_tier_code,
           support_mode_code, parts_coverage_code, hw_refresh_code, updates_code, upgrades_code,
           warranty_end_date_source, valid_from, valid_from_basis, valid_from_precision,
           valid_to, is_current, normalization_status,
           source_import_id, source_row_number, source_row_hash, contract_fingerprint)
        VALUES
          ($1,$2,$3,$4, $5,$6,$7, $8,$9,$10,$11,$12, $13,$14,$15,$16, NULL, true, $17, $18,$19,$20, $21)`;
      const insertParams = fp => [
        currentRow.equipment_key, currentRow.client_name_canonical, currentRow.client_name_raw, currentRow.equipment_model,
        currentRow.installation_date_precision, currentRow.contract_status_code, currentRow.spa_tier_code,
        currentRow.support_mode_code, currentRow.parts_coverage_code, currentRow.hw_refresh_code, currentRow.updates_code, currentRow.upgrades_code,
        currentRow.warranty_end_date_source, currentRow.valid_from, currentRow.valid_from_basis, currentRow.valid_from_precision,
        currentRow.normalization_status,
        currentRow.source_import_id, currentRow.source_row_number, currentRow.source_row_hash, fp
      ];

      await clientA.query(insertSql, insertParams("concurrencia-tx-a"));
      await clientA.query("COMMIT");

      // clientB intenta lo mismo DESPUÉS de que A ya confirmó -debe fallar:
      // ya existe una fila is_current=true para este (equipment_key, valid_from).
      await clientB.query(
        `UPDATE config.contract_equipment_versions SET is_current = false, superseded_at = now() WHERE contract_version_id = $1`,
        [currentRow.contract_version_id]
      );
      await assert.rejects(
        () => clientB.query(insertSql, insertParams("concurrencia-tx-b")),
        /duplicate key|contract_equipment_versions_current_per_period_uidx/
      );
      await clientB.query("ROLLBACK");

      const finalCurrent = await adminPool.query(
        "SELECT count(*) AS n, array_agg(contract_fingerprint) AS fps FROM config.contract_equipment_versions WHERE equipment_key = 'SN:777001' AND is_current = true"
      );
      assert.equal(Number(finalCurrent.rows[0].n), 1, "exactamente una revisión is_current=true tras la concurrencia -nunca dos");
      assert.deepEqual(finalCurrent.rows[0].fps, ["concurrencia-tx-a"], "solo la transacción que confirmó primero queda como autoritativa");
    } finally {
      clientA.release();
      clientB.release();
    }
  });

  // === Defecto 1 (corregido, 2ª ronda): NULLS NOT DISTINCT ===
  // anio: "" fuerza installation_date_precision=UNKNOWN -> valid_from=NULL,
  // valid_from_basis=UNRESOLVED (contract-start-date-resolver.js, ETAPA
  // 6.5.1) -escenario real y ya soportado por el resto del pipeline, nunca
  // un valor artificial. Todos usan el mismo equipment_key (SN:777010) para
  // ejercer directamente la autoridad única bajo valid_from=NULL.

  await t.test("NULL-1: revisión inicial con valid_from=NULL -> NEW, is_current=true", async () => {
    await adminPool.query(
      `INSERT INTO processed.fieldbeat_equipments (equipment_key, equipment_uuid, internal_id, client_key) VALUES ('K-LC10','u-lc10','Linac-777010','C-LC')`
    );
    const result = await applyContracts({ file: await writeFixture("null1.csv", makeFixtureCsv({ serie: "777010", anio: "" })), effectiveDate: "2026-01-01" });
    assert.equal(result.results[0].versionAction, "NEW");

    const versions = await adminPool.query(
      "SELECT valid_from, valid_from_basis, is_current FROM config.contract_equipment_versions WHERE equipment_key = 'SN:777010'"
    );
    assert.equal(versions.rows.length, 1);
    assert.equal(versions.rows[0].valid_from, null);
    assert.equal(versions.rows[0].valid_from_basis, "UNRESOLVED");
    assert.equal(versions.rows[0].is_current, true);
  });

  await t.test("NULL-2: reimportación idéntica con valid_from=NULL -> UNCHANGED, sin fila nueva", async () => {
    const before1 = await adminPool.query("SELECT count(*) AS n FROM config.contract_equipment_versions WHERE equipment_key = 'SN:777010'");
    const result = await applyContracts({ file: await writeFixture("null2.csv", makeFixtureCsv({ serie: "777010", anio: "", notas: "cosmetico" })), effectiveDate: "2026-01-15" });
    assert.equal(result.results[0].versionAction, "UNCHANGED");
    const after1 = await adminPool.query("SELECT count(*) AS n FROM config.contract_equipment_versions WHERE equipment_key = 'SN:777010'");
    assert.equal(before1.rows[0].n, after1.rows[0].n);
  });

  await t.test("NULL-3: Gold -> Silver con valid_from=NULL -> SUPERSEDE, ambas revisiones con valid_from=NULL, exactamente 1 is_current=true", async () => {
    const result = await applyContracts({ file: await writeFixture("null3.csv", makeFixtureCsv({ serie: "777010", anio: "", spa: "Silver (Sólo Soporte)" })), effectiveDate: "2026-02-01" });
    assert.equal(result.results[0].versionAction, "SUPERSEDE");

    const versions = await adminPool.query(
      "SELECT spa_tier_code, is_current, superseded_at, valid_from FROM config.contract_equipment_versions WHERE equipment_key = 'SN:777010' ORDER BY contract_version_id"
    );
    assert.equal(versions.rows.length, 2);
    assert.deepEqual(versions.rows.map(r => r.spa_tier_code), ["GOLD", "SILVER"]);
    assert.deepEqual(versions.rows.map(r => r.is_current), [false, true]);
    assert.ok(versions.rows[0].superseded_at);
    assert.equal(versions.rows[1].superseded_at, null);
    assert.equal(versions.rows[0].valid_from, null);
    assert.equal(versions.rows[1].valid_from, null);

    const currentCount = await adminPool.query(
      "SELECT count(*) AS n FROM config.contract_equipment_versions WHERE equipment_key = 'SN:777010' AND is_current = true"
    );
    assert.equal(Number(currentCount.rows[0].n), 1);
  });

  await t.test("NULL-4: forzar 2 revisiones is_current=true con valid_from=NULL para el mismo equipment_key -> falla (NULLS NOT DISTINCT)", async () => {
    const current = await adminPool.query(
      "SELECT contract_version_id FROM config.contract_equipment_versions WHERE equipment_key = 'SN:777010' AND is_current = true"
    );
    assert.equal(current.rows.length, 1);

    // Sin NULLS NOT DISTINCT, Postgres trataría dos valid_from NULL como
    // "distintos" y permitiría esto -exactamente el defecto 1 que sql/085
    // corrige en esta ronda.
    await assert.rejects(
      () => adminPool.query(
        `INSERT INTO config.contract_equipment_versions
           (equipment_key, client_name_canonical, client_name_raw, equipment_model,
            installation_date_precision, contract_status_code, spa_tier_code,
            support_mode_code, parts_coverage_code, hw_refresh_code, updates_code, upgrades_code,
            warranty_end_date_source, valid_from, valid_from_basis, valid_from_precision,
            valid_to, is_current, normalization_status,
            source_import_id, source_row_number, source_row_hash, contract_fingerprint)
         SELECT equipment_key, client_name_canonical, client_name_raw, equipment_model,
                installation_date_precision, contract_status_code, spa_tier_code,
                support_mode_code, parts_coverage_code, hw_refresh_code, updates_code, upgrades_code,
                warranty_end_date_source, valid_from, valid_from_basis, valid_from_precision,
                NULL, true, normalization_status,
                source_import_id, source_row_number, source_row_hash, 'fingerprint-null-forzado'
         FROM config.contract_equipment_versions WHERE contract_version_id = $1`,
        [current.rows[0].contract_version_id]
      ),
      /duplicate key|contract_equipment_versions_current_per_period_uidx/
    );

    const stillOne = await adminPool.query(
      "SELECT count(*) AS n FROM config.contract_equipment_versions WHERE equipment_key = 'SN:777010' AND is_current = true"
    );
    assert.equal(Number(stillOne.rows[0].n), 1);
  });

  await t.test("NULL-5: concurrencia con valid_from=NULL -dos transacciones intentando ser is_current=true, la segunda debe fallar", async () => {
    const clientA = await adminPool.connect();
    const clientB = await adminPool.connect();
    try {
      const currentRow = (await adminPool.query(
        "SELECT * FROM config.contract_equipment_versions WHERE equipment_key = 'SN:777010' AND is_current = true"
      )).rows[0];
      assert.equal(currentRow.valid_from, null);

      await clientA.query("BEGIN");
      await clientB.query("BEGIN");

      await clientA.query(
        `UPDATE config.contract_equipment_versions SET is_current = false, superseded_at = now() WHERE contract_version_id = $1`,
        [currentRow.contract_version_id]
      );

      const insertSql = `
        INSERT INTO config.contract_equipment_versions
          (equipment_key, client_name_canonical, client_name_raw, equipment_model,
           installation_date_precision, contract_status_code, spa_tier_code,
           support_mode_code, parts_coverage_code, hw_refresh_code, updates_code, upgrades_code,
           warranty_end_date_source, valid_from, valid_from_basis, valid_from_precision,
           valid_to, is_current, normalization_status,
           source_import_id, source_row_number, source_row_hash, contract_fingerprint)
        VALUES
          ($1,$2,$3,$4, $5,$6,$7, $8,$9,$10,$11,$12, $13,$14,$15,$16, NULL, true, $17, $18,$19,$20, $21)`;
      const insertParams = fp => [
        currentRow.equipment_key, currentRow.client_name_canonical, currentRow.client_name_raw, currentRow.equipment_model,
        currentRow.installation_date_precision, currentRow.contract_status_code, currentRow.spa_tier_code,
        currentRow.support_mode_code, currentRow.parts_coverage_code, currentRow.hw_refresh_code, currentRow.updates_code, currentRow.upgrades_code,
        currentRow.warranty_end_date_source, currentRow.valid_from, currentRow.valid_from_basis, currentRow.valid_from_precision,
        currentRow.normalization_status,
        currentRow.source_import_id, currentRow.source_row_number, currentRow.source_row_hash, fp
      ];

      await clientA.query(insertSql, insertParams("concurrencia-null-tx-a"));
      await clientA.query("COMMIT");

      await clientB.query(
        `UPDATE config.contract_equipment_versions SET is_current = false, superseded_at = now() WHERE contract_version_id = $1`,
        [currentRow.contract_version_id]
      );
      await assert.rejects(
        () => clientB.query(insertSql, insertParams("concurrencia-null-tx-b")),
        /duplicate key|contract_equipment_versions_current_per_period_uidx/
      );
      await clientB.query("ROLLBACK");

      const finalCurrent = await adminPool.query(
        "SELECT count(*) AS n, array_agg(contract_fingerprint) AS fps FROM config.contract_equipment_versions WHERE equipment_key = 'SN:777010' AND is_current = true"
      );
      assert.equal(Number(finalCurrent.rows[0].n), 1);
      assert.deepEqual(finalCurrent.rows[0].fps, ["concurrencia-null-tx-a"]);
    } finally {
      clientA.release();
      clientB.release();
    }
  });
});
