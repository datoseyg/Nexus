// ETAPA 6.5.2B0 - Investigación: en loadReferenceData() (db-writer.js),
// fbKeyByUuid = new Map(rows.map(r => [r.equipment_uuid, r.equipment_key]))
// nunca excluía equipment_uuid NULL/''. Como Map usa SameValueZero (null
// === null), N filas con equipment_uuid=NULL colapsan en UNA sola entrada
// -la última iterada gana- y cualquier tarea cuyo enlace también tenga
// equipment_uuid=NULL hereda esa identidad ajena (no undefined, así que el
// guard `if (!key) continue` de la línea de consumo NUNCA la detiene).
// Confirmado empíricamente contra datos reales: processed.fieldbeat_tasks
// 76/83/92 (FUNDACION ARTURO LOPEZ PEREZ, equipos reales "Linac-153038"/
// "153038") heredaban hoy FIELDBEAT_EQUIPMENT||INC-INFINITY01 -equipo
// ajeno, de otro cliente.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBulkInsert, buildFieldbeatKeyByUuid } from "../../src/working-hours/db-writer.js";

test("publicación incremental genera UPSERT y nunca TRUNCATE", () => {
  const { sql } = buildBulkInsert(
    "marts.example",
    ["fieldbeat_task_id", "data_basis"],
    [[3824, "CONTRACTUAL"]],
    { conflictTarget: ["fieldbeat_task_id"], updateColumns: ["data_basis"], returning: "working_hours_id" }
  );
  assert.match(sql, /ON CONFLICT \(fieldbeat_task_id\) DO UPDATE SET data_basis = EXCLUDED\.data_basis/);
  assert.match(sql, /RETURNING working_hours_id$/);
  assert.doesNotMatch(sql, /TRUNCATE/i);
});

// === Caso A - colisión vacía (equipment_uuid='') ===

test("Caso A: 2 equipos distintos con equipment_uuid='' -> ninguno es resoluble por esa clave, nunca se asigna arbitrariamente", () => {
  const rows = [
    { equipment_uuid: "", equipment_key: "FIELDBEAT_EQUIPMENT||EQUIPO-A" },
    { equipment_uuid: "", equipment_key: "FIELDBEAT_EQUIPMENT||EQUIPO-B" }
  ];
  const map = buildFieldbeatKeyByUuid(rows);
  assert.equal(map.get(""), undefined, "'' nunca debe resolver a ningún equipment_key");
  assert.equal(map.has(""), false);
});

// === Caso B - colisión NULL (el caso real observado en producción) ===

test("Caso B: 2 equipos distintos con equipment_uuid=NULL -> ninguno es resoluble por esa clave, nunca se asigna arbitrariamente", () => {
  const rows = [
    { equipment_uuid: null, equipment_key: "FIELDBEAT_EQUIPMENT||EQUIPO-A" },
    { equipment_uuid: null, equipment_key: "FIELDBEAT_EQUIPMENT||EQUIPO-B" }
  ];
  const map = buildFieldbeatKeyByUuid(rows);
  assert.equal(map.get(null), undefined, "null nunca debe resolver a ningún equipment_key");
  assert.equal(map.has(null), false);
});

test("Caso B: mezcla NULL + real -> el real resuelve exacto, NULL sigue sin resolver", () => {
  const rows = [
    { equipment_uuid: null, equipment_key: "FIELDBEAT_EQUIPMENT||EQUIPO-A" },
    { equipment_uuid: "uuid-real-1", equipment_key: "FIELDBEAT_EQUIPMENT|uuid-real-1|EQUIPO-C" },
    { equipment_uuid: null, equipment_key: "FIELDBEAT_EQUIPMENT||EQUIPO-B" }
  ];
  const map = buildFieldbeatKeyByUuid(rows);
  assert.equal(map.get("uuid-real-1"), "FIELDBEAT_EQUIPMENT|uuid-real-1|EQUIPO-C");
  assert.equal(map.has(null), false);
});

// === Caso C - UUID válido y único sigue resolviendo exacto ===

test("Caso C: UUID real y único resuelve exactamente su equipment_key, sin verse afectado por filas NULL en la misma consulta", () => {
  const rows = [
    { equipment_uuid: null, equipment_key: "FIELDBEAT_EQUIPMENT||RUIDO-1" },
    { equipment_uuid: "8569b998-f5a4-405d-8bcb-2fd208570906", equipment_key: "FIELDBEAT_EQUIPMENT|8569b998-f5a4-405d-8bcb-2fd208570906|LINAC-153038" },
    { equipment_uuid: null, equipment_key: "FIELDBEAT_EQUIPMENT||RUIDO-2" }
  ];
  const map = buildFieldbeatKeyByUuid(rows);
  assert.equal(map.get("8569b998-f5a4-405d-8bcb-2fd208570906"), "FIELDBEAT_EQUIPMENT|8569b998-f5a4-405d-8bcb-2fd208570906|LINAC-153038");
});

// === Caso D - estabilidad de orden (el resultado no depende de qué fila NULL fue leída al final) ===

test("Caso D: invertir el orden de las filas de referencia no cambia el resultado -NULL sigue sin resolver en ambos órdenes", () => {
  const rowsAsc = [
    { equipment_uuid: null, equipment_key: "FIELDBEAT_EQUIPMENT||EQUIPO-A" },
    { equipment_uuid: "uuid-real-1", equipment_key: "FIELDBEAT_EQUIPMENT|uuid-real-1|EQUIPO-C" },
    { equipment_uuid: null, equipment_key: "FIELDBEAT_EQUIPMENT||EQUIPO-B" },
    { equipment_uuid: null, equipment_key: "FIELDBEAT_EQUIPMENT||EQUIPO-Z" }
  ];
  const rowsDesc = [...rowsAsc].reverse();

  const mapAsc = buildFieldbeatKeyByUuid(rowsAsc);
  const mapDesc = buildFieldbeatKeyByUuid(rowsDesc);

  assert.equal(mapAsc.has(null), false);
  assert.equal(mapDesc.has(null), false);
  assert.equal(mapAsc.get("uuid-real-1"), mapDesc.get("uuid-real-1"));
  assert.deepEqual([...mapAsc.entries()], [...mapDesc.entries()].reverse(), "con solo 1 clave real presente en ambos órdenes, las entradas deben coincidir exactamente (invertidas)");
});

// === Caso E - no contaminación cruzada (documentado a nivel de función pura; el nivel de tarea completo se prueba en db-writer.integration.test.js) ===

test("Caso E: una fila NULL nunca puede heredar el equipment_key de una fila real de OTRO cliente/máquina/modelo cargada en la misma consulta", () => {
  const rows = [
    { equipment_uuid: null, equipment_key: "FIELDBEAT_EQUIPMENT||TAREA-SIN-IDENTIDAD" },
    { equipment_uuid: "real-uuid-inc", equipment_key: "FIELDBEAT_EQUIPMENT|real-uuid-inc|INC-INFINITY01" }
  ];
  const map = buildFieldbeatKeyByUuid(rows);
  // La fila NULL no debe resolver a NADA, mucho menos al equipo real de INC
  // cargado en la misma consulta (el bug real: FALP heredaba INC-INFINITY01).
  assert.equal(map.get(null), undefined);
  assert.notEqual(map.get(null), "FIELDBEAT_EQUIPMENT|real-uuid-inc|INC-INFINITY01");
});

// === Reproducción textual del caso real (documentación, no verificación de builder completo) ===

test("reproducción: 3 filas equipment_uuid=NULL para 3 equipos DISTINTOS de FALP no colapsan en una sola identidad", () => {
  const rows = [
    { equipment_uuid: null, equipment_key: "FIELDBEAT_EQUIPMENT||153038" }, // internal_id real "153038"
    { equipment_uuid: null, equipment_key: "FIELDBEAT_EQUIPMENT||Linac-153038" }, // internal_id real "Linac-153038"
    { equipment_uuid: "real-uuid-inc", equipment_key: "FIELDBEAT_EQUIPMENT|real-uuid-inc|INC-INFINITY01" }
  ];
  const map = buildFieldbeatKeyByUuid(rows);
  assert.equal(map.has(null), false, "ninguna de las 2 filas NULL debe quedar resoluble, ni siquiera con el 'último gana'");
});
