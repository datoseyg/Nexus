import { test } from "node:test";
import assert from "node:assert/strict";
import { matchOneEquipment, matchAll, matchResultToIssues } from "../../src/contracts/fieldbeat-matcher.js";
import { buildClientIdentityAliasIndex } from "../../src/contracts/client-identity-aliases.js";

const FIELDBEAT_EQUIPMENTS = [
  { equipment_key: "K1", equipment_uuid: "u1", internal_id: "Linac-109166", client_key: "C1" },
  { equipment_key: "K2", equipment_uuid: "u2", internal_id: "Linac-999999", client_key: "C1" },
  { equipment_key: "K3", equipment_uuid: "u3", internal_id: "Linac-500000", client_key: "C2" },
  { equipment_key: "K4", equipment_uuid: "u4", internal_id: "Linac-500000", client_key: "C2" }
];
const FIELDBEAT_CLIENTS = [
  { client_key: "C1", client_name: "Cliente Uno" },
  { client_key: "C2", client_name: "Cliente Dos" }
];

test("match exacto por sufijo de serie -> MATCHED", () => {
  const r = matchOneEquipment(
    { equipmentKey: "SN:109166", clientNameCanonical: "Cliente Uno", equipmentModel: "VersaHD", serialNumber: "109166" },
    { fieldbeatEquipments: FIELDBEAT_EQUIPMENTS, fieldbeatClients: FIELDBEAT_CLIENTS, overrides: [] }
  );
  assert.equal(r.matchStatus, "MATCHED");
  assert.equal(r.matchMethod, "SERIAL_SUFFIX");
  assert.equal(r.fieldbeatEquipmentKey, "K1");
  assert.equal(matchResultToIssues(r).length, 0);
});

test("match ambiguo por sufijo de serie duplicado -> AMBIGUOUS, nunca autoconfirmado", () => {
  const r = matchOneEquipment(
    { equipmentKey: "SN:500000", clientNameCanonical: "Cliente Dos", equipmentModel: "VersaHD", serialNumber: "500000" },
    { fieldbeatEquipments: FIELDBEAT_EQUIPMENTS, fieldbeatClients: FIELDBEAT_CLIENTS, overrides: [] }
  );
  assert.equal(r.matchStatus, "AMBIGUOUS");
  assert.equal(r.candidateCount, 2);
  assert.equal(r.fieldbeatEquipmentKey, null);
  assert.equal(matchResultToIssues(r)[0].issueType, "AMBIGUOUS_FIELDBEAT_MATCH");
});

test("sin serial y sin candidato de cliente+modelo -> UNMATCHED", () => {
  const r = matchOneEquipment(
    { equipmentKey: "PROV:abc", clientNameCanonical: "Cliente Inexistente", equipmentModel: "Flexitron", serialNumber: null },
    { fieldbeatEquipments: FIELDBEAT_EQUIPMENTS, fieldbeatClients: FIELDBEAT_CLIENTS, overrides: [] }
  );
  assert.equal(r.matchStatus, "UNMATCHED");
  assert.equal(r.matchMethod, "NONE");
  assert.equal(matchResultToIssues(r)[0].issueType, "UNMATCHED_FIELDBEAT_EQUIPMENT");
});

test("override activo -> MATCHED vía OVERRIDE, tiene prioridad sobre el resto", () => {
  const r = matchOneEquipment(
    { equipmentKey: "SN:109166", clientNameCanonical: "Cliente Uno", equipmentModel: "VersaHD", serialNumber: "109166" },
    {
      fieldbeatEquipments: FIELDBEAT_EQUIPMENTS,
      fieldbeatClients: FIELDBEAT_CLIENTS,
      overrides: [{ equipmentKey: "SN:109166", fieldbeatEquipmentId: "K2" }]
    }
  );
  assert.equal(r.matchStatus, "MATCHED");
  assert.equal(r.matchMethod, "OVERRIDE");
  assert.equal(r.fieldbeatEquipmentKey, "K2");
});

test("cliente+categoría de equipo con un solo candidato -> MATCHED vía CLIENT_SITE_MODEL", () => {
  const r = matchOneEquipment(
    { equipmentKey: "PROV:xyz", clientNameCanonical: "Cliente Uno", equipmentModel: "VersaHD", serialNumber: null },
    { fieldbeatEquipments: FIELDBEAT_EQUIPMENTS, fieldbeatClients: FIELDBEAT_CLIENTS, overrides: [] }
  );
  // Cliente Uno tiene 2 equipos LINAC (K1, K2) -> ambiguo, no 1 solo.
  assert.equal(r.matchStatus, "AMBIGUOUS");
  assert.equal(r.matchMethod, "CLIENT_SITE_MODEL");
});

// === ETAPA 6.5.2B1 - fila "fantasma" con equipment_uuid NULL/'' en
// processed.fieldbeat_equipments (mismo internal_id que un equipo real).
// Hallazgo empírico contra datos reales: 24 internal_id de la tabla maestra
// tienen exactamente este patrón (ej. "Linac-201110": 1 fila con uuid real
// dc36d94e-..., 1 fila con uuid NULL). matchOneEquipment() filtraba
// fieldbeatEquipments sin excluir estas filas fantasma, así que
// extractTrailingSerial() encontraba 2 "candidatos" para un único equipo
// físico real -> AMBIGUOUS en vez de MATCHED, incluso con serial único y
// exacto. Confirmado que esto bloqueaba TODOS los 7 candidatos que 6.5.2B0
// había clasificado como seguros (SN:153038, SN:152171, SN:154325,
// SN:153935, SN:151673, SN:FT07026, SN:FT02211), no solo Linac-201110/201172.
const FIELDBEAT_EQUIPMENTS_WITH_GHOST_ROW = [
  { equipment_key: "K1", equipment_uuid: "u1", internal_id: "Linac-109166", client_key: "C1" },
  { equipment_key: "GHOST1", equipment_uuid: null, internal_id: "Linac-109166", client_key: "C1" },
  { equipment_key: "K5", equipment_uuid: "u5", internal_id: "Linac-777777", client_key: "C1" },
  { equipment_key: "GHOST2", equipment_uuid: "", internal_id: "Linac-777777", client_key: "C1" }
];

test("fila fantasma equipment_uuid=NULL con mismo internal_id que un equipo real -> MATCHED (el fantasma no cuenta como candidato)", () => {
  const r = matchOneEquipment(
    { equipmentKey: "SN:109166", clientNameCanonical: "Cliente Uno", equipmentModel: "VersaHD", serialNumber: "109166" },
    { fieldbeatEquipments: FIELDBEAT_EQUIPMENTS_WITH_GHOST_ROW, fieldbeatClients: FIELDBEAT_CLIENTS, overrides: [] }
  );
  assert.equal(r.matchStatus, "MATCHED");
  assert.equal(r.matchMethod, "SERIAL_SUFFIX");
  assert.equal(r.fieldbeatEquipmentKey, "K1");
  assert.equal(r.candidateCount, 1);
});

test("fila fantasma equipment_uuid='' (string vacío) con mismo internal_id que un equipo real -> MATCHED", () => {
  const r = matchOneEquipment(
    { equipmentKey: "SN:777777", clientNameCanonical: "Cliente Uno", equipmentModel: "VersaHD", serialNumber: "777777" },
    { fieldbeatEquipments: FIELDBEAT_EQUIPMENTS_WITH_GHOST_ROW, fieldbeatClients: FIELDBEAT_CLIENTS, overrides: [] }
  );
  assert.equal(r.matchStatus, "MATCHED");
  assert.equal(r.matchMethod, "SERIAL_SUFFIX");
  assert.equal(r.fieldbeatEquipmentKey, "K5");
});

test("2 filas REALES (uuid no nulo) con serial duplicado siguen siendo AMBIGUOUS -el filtro de fantasmas no oculta una ambigüedad real", () => {
  const r = matchOneEquipment(
    { equipmentKey: "SN:500000", clientNameCanonical: "Cliente Dos", equipmentModel: "VersaHD", serialNumber: "500000" },
    { fieldbeatEquipments: FIELDBEAT_EQUIPMENTS, fieldbeatClients: FIELDBEAT_CLIENTS, overrides: [] }
  );
  assert.equal(r.matchStatus, "AMBIGUOUS");
  assert.equal(r.candidateCount, 2);
});

// === ETAPA 6.5.2B1 - consumo de gobernanza de alias de cliente en Nivel 3
// (CLIENT_SITE_MODEL). Solo entra en juego cuando el Nivel 2 (serial) no
// resuelve nada -un alias de cliente nunca basta por sí solo, sigue
// requiriendo unicidad de candidato por cliente+categoría. ===
const ALIAS_ENTRIES = [
  { canonical_name: "Sanatorio Alemán", aliases: ["ONCORAD", "CLÍNICA SANATORIO ALEMÁN (ONCORAD)"], approved: true },
  { canonical_name: "Instituto Radio Oncológico", aliases: ["INRAD"], approved: true },
  { canonical_name: "Cliente No Aprobado", aliases: ["ALIAS_SIN_APROBAR"], approved: false }
];
const ALIAS_INDEX = buildClientIdentityAliasIndex(ALIAS_ENTRIES);

const FIELDBEAT_EQUIPMENTS_ALIASED_CLIENT = [
  // Cliente FieldBeat real es un ALIAS ("ONCORAD"), no el nombre canónico
  // del contrato ("Sanatorio Alemán") -sin gobernanza de alias, Nivel 3
  // nunca encontraría este client_key en candidateClientKeys.
  { equipment_key: "K10", equipment_uuid: "u10", internal_id: "Compact-ONCORAD-1", client_key: "C10" },
  { equipment_key: "K11", equipment_uuid: "u11", internal_id: "Compact-INRAD-1", client_key: "C11" },
  { equipment_key: "K12", equipment_uuid: "u12", internal_id: "Compact-INRAD-2", client_key: "C11" }
];
const FIELDBEAT_CLIENTS_ALIASED = [
  { client_key: "C10", client_name: "ONCORAD" },
  { client_key: "C11", client_name: "INRAD" }
];

test("6. alias de cliente confirmado, sin serial y sin categoría de equipo compatible -> UNMATCHED (el alias no basta por sí solo)", () => {
  const r = matchOneEquipment(
    { equipmentKey: "SN:XYZ", clientNameCanonical: "Sanatorio Alemán", equipmentModel: "Synergy", serialNumber: null },
    { fieldbeatEquipments: FIELDBEAT_EQUIPMENTS_ALIASED_CLIENT, fieldbeatClients: FIELDBEAT_CLIENTS_ALIASED, overrides: [], clientAliasIndex: ALIAS_INDEX }
  );
  // "Compact-ONCORAD-1" no clasifica a categoría LINAC/BRAQUITERAPIA (no
  // contiene "linac"/"braqui") -> 0 candidatos, sigue UNMATCHED aunque el
  // cliente ya esté resuelto por alias.
  assert.equal(r.matchStatus, "UNMATCHED");
});

test("7. sin serial útil + alias confirmado (ONCORAD->Sanatorio Alemán) + candidato único por cliente+categoría -> MATCHED vía CLIENT_SITE_MODEL", () => {
  const equipments = [...FIELDBEAT_EQUIPMENTS_ALIASED_CLIENT, { equipment_key: "K13", equipment_uuid: "u13", internal_id: "Linac-ONCORAD-1", client_key: "C10" }];
  const r = matchOneEquipment(
    { equipmentKey: "SN:201110", clientNameCanonical: "Sanatorio Alemán", equipmentModel: "Compact", serialNumber: null },
    { fieldbeatEquipments: equipments, fieldbeatClients: FIELDBEAT_CLIENTS_ALIASED, overrides: [], clientAliasIndex: ALIAS_INDEX }
  );
  assert.equal(r.matchStatus, "MATCHED");
  assert.equal(r.matchMethod, "CLIENT_SITE_MODEL");
  assert.equal(r.fieldbeatEquipmentKey, "K13");
});

test("8. sin serial útil + alias confirmado + 2 candidatos por cliente+categoría -> AMBIGUOUS, nunca autoconfirmado", () => {
  const equipments = [
    { equipment_key: "K20", equipment_uuid: "u20", internal_id: "Linac-INRAD-1", client_key: "C11" },
    { equipment_key: "K21", equipment_uuid: "u21", internal_id: "Linac-INRAD-2", client_key: "C11" }
  ];
  const r = matchOneEquipment(
    { equipmentKey: "SN:INRAD-X", clientNameCanonical: "Instituto Radio Oncológico", equipmentModel: "Synergy", serialNumber: null },
    { fieldbeatEquipments: equipments, fieldbeatClients: FIELDBEAT_CLIENTS_ALIASED, overrides: [], clientAliasIndex: ALIAS_INDEX }
  );
  assert.equal(r.matchStatus, "AMBIGUOUS");
  assert.equal(r.matchMethod, "CLIENT_SITE_MODEL");
  assert.equal(r.candidateCount, 2);
});

test("9. cliente sin ningún alias gobernado y sin fold-match directo -> sigue UNMATCHED (rechazado)", () => {
  const r = matchOneEquipment(
    { equipmentKey: "SN:INCOMPATIBLE", clientNameCanonical: "Cliente Totalmente Distinto", equipmentModel: "Synergy", serialNumber: null },
    { fieldbeatEquipments: FIELDBEAT_EQUIPMENTS_ALIASED_CLIENT, fieldbeatClients: FIELDBEAT_CLIENTS_ALIASED, overrides: [], clientAliasIndex: ALIAS_INDEX }
  );
  assert.equal(r.matchStatus, "UNMATCHED");
});

test("un alias con approved=false nunca se consume en el matcher -sigue UNMATCHED como si el alias no existiera", () => {
  const equipments = [{ equipment_key: "K30", equipment_uuid: "u30", internal_id: "Linac-NoAprobado-1", client_key: "C30" }];
  const clients = [{ client_key: "C30", client_name: "ALIAS_SIN_APROBAR" }];
  const r = matchOneEquipment(
    { equipmentKey: "SN:NOAPROBADO", clientNameCanonical: "Cliente No Aprobado", equipmentModel: "Synergy", serialNumber: null },
    { fieldbeatEquipments: equipments, fieldbeatClients: clients, overrides: [], clientAliasIndex: ALIAS_INDEX }
  );
  assert.equal(r.matchStatus, "UNMATCHED");
});

test("sin clientAliasIndex en el ctx (compatibilidad hacia atrás), el comportamiento no cambia respecto al fold directo existente", () => {
  const r = matchOneEquipment(
    { equipmentKey: "PROV:xyz", clientNameCanonical: "Cliente Uno", equipmentModel: "VersaHD", serialNumber: null },
    { fieldbeatEquipments: FIELDBEAT_EQUIPMENTS, fieldbeatClients: FIELDBEAT_CLIENTS, overrides: [] }
  );
  assert.equal(r.matchStatus, "AMBIGUOUS");
  assert.equal(r.matchMethod, "CLIENT_SITE_MODEL");
});

// === Corrección de dominio (post-6.5.2B1) - Compact y Precise son máquinas
// físicas DISTINTAS, con seriales y contratos distintos, aunque compartan
// cliente. "LINAC" es solo la categoría funcional (Linear Accelerator), no
// identifica una máquina. Caso real: Sanatorio Alemán tiene Compact
// (SN:201110) y Precise (SN:105614); FieldBeat solo tiene UN internal_id
// "Linac-201110" registrado -antes de esta corrección, SN:105614 (sin
// candidato de serial) caía al Nivel 3 (cliente+categoría), encontraba ESE
// único internal_id "Linac-201110" y lo tomaba como MATCHED, aunque ya
// pertenecía en verdad a SN:201110 por serial exacto -Nivel 3 contaminaba
// una resolución ya resuelta por evidencia más fuerte (Nivel 2). ===
const SANATORIO_EQUIPMENTS = [
  { equipment_key: "FB_COMPACT_201110", equipment_uuid: "uuid-201110", internal_id: "Linac-201110", client_key: "C_SANATORIO" }
];
const SANATORIO_CLIENTS = [{ client_key: "C_SANATORIO", client_name: "Sanatorio Alemán" }];
const compactCandidate = { equipmentKey: "SN:201110", clientNameCanonical: "Sanatorio Alemán", equipmentModel: "Compact", serialNumber: "201110" };
const preciseCandidate = { equipmentKey: "SN:105614", clientNameCanonical: "Sanatorio Alemán", equipmentModel: "Precise", serialNumber: "105614" };

test("Compact SN:201110 + Precise SN:105614, mismo cliente, FieldBeat solo tiene Linac-201110: Compact resuelve únicamente ese equipo, Precise NUNCA lo hereda", () => {
  const results = matchAll([compactCandidate, preciseCandidate], { fieldbeatEquipments: SANATORIO_EQUIPMENTS, fieldbeatClients: SANATORIO_CLIENTS, overrides: [] });
  const compactResult = results.find(r => r.equipmentKey === "SN:201110");
  const preciseResult = results.find(r => r.equipmentKey === "SN:105614");

  assert.equal(compactResult.matchStatus, "MATCHED");
  assert.equal(compactResult.matchMethod, "SERIAL_SUFFIX");
  assert.equal(compactResult.fieldbeatEquipmentKey, "FB_COMPACT_201110");

  assert.notEqual(preciseResult.matchStatus, "MATCHED");
  assert.notEqual(preciseResult.fieldbeatEquipmentKey, "FB_COMPACT_201110");
});

test("invertir el orden de los 2 contratos (Precise antes que Compact): el resultado sigue siendo idéntico -Compact resuelve SN:201110, Precise nunca lo hereda", () => {
  const results = matchAll([preciseCandidate, compactCandidate], { fieldbeatEquipments: SANATORIO_EQUIPMENTS, fieldbeatClients: SANATORIO_CLIENTS, overrides: [] });
  const compactResult = results.find(r => r.equipmentKey === "SN:201110");
  const preciseResult = results.find(r => r.equipmentKey === "SN:105614");

  assert.equal(compactResult.matchStatus, "MATCHED");
  assert.equal(compactResult.fieldbeatEquipmentKey, "FB_COMPACT_201110");
  assert.notEqual(preciseResult.matchStatus, "MATCHED");
});

test("cliente+categoría LINAC nunca basta sola cuando el cliente tiene más de un acelerador contractual de esa categoría -> AMBIGUOUS, nunca autoconfirmado", () => {
  const results = matchAll([compactCandidate, preciseCandidate], { fieldbeatEquipments: SANATORIO_EQUIPMENTS, fieldbeatClients: SANATORIO_CLIENTS, overrides: [] });
  const preciseResult = results.find(r => r.equipmentKey === "SN:105614");
  assert.equal(preciseResult.matchStatus, "AMBIGUOUS");
  assert.equal(preciseResult.matchMethod, "CLIENT_SITE_MODEL");
  // config.contract_equipment_matches tiene un CHECK real: AMBIGUOUS exige
  // candidate_count > 1 (invariante de la BD, no solo del código) -aunque
  // solo exista 1 equipo FieldBeat físico en disputa, candidateCount debe
  // reflejar cuántos candidatos CONTRACTUALES compiten por él, no cuántas
  // filas FieldBeat se encontraron.
  assert.ok(preciseResult.candidateCount > 1, `candidateCount debe ser > 1 para satisfacer el CHECK de la BD, fue ${preciseResult.candidateCount}`);
});

test("un valor 'Linac' sin serial, con DOS equipos LINAC reales de FieldBeat del mismo cliente -> sigue AMBIGUOUS (comportamiento ya existente, no roto por la corrección)", () => {
  const twoRealLinacs = [
    { equipment_key: "FB_L1", equipment_uuid: "u1", internal_id: "Linac-A", client_key: "C_SANATORIO" },
    { equipment_key: "FB_L2", equipment_uuid: "u2", internal_id: "Linac-B", client_key: "C_SANATORIO" }
  ];
  const r = matchOneEquipment(
    { equipmentKey: "SN:SINSERIAL", clientNameCanonical: "Sanatorio Alemán", equipmentModel: "Compact", serialNumber: null },
    { fieldbeatEquipments: twoRealLinacs, fieldbeatClients: SANATORIO_CLIENTS, overrides: [] }
  );
  assert.equal(r.matchStatus, "AMBIGUOUS");
  assert.equal(r.matchMethod, "CLIENT_SITE_MODEL");
  assert.equal(r.candidateCount, 2);
});

test("un candidato con serial desconocido (null) no puede caer en un equipo ya reclamado por OTRO candidato vía serial exacto, solo por compartir cliente+categoría", () => {
  const unknownSerialCandidate = { equipmentKey: "SN:DESCONOCIDO", clientNameCanonical: "Sanatorio Alemán", equipmentModel: "Precise", serialNumber: null };
  const results = matchAll([compactCandidate, unknownSerialCandidate], { fieldbeatEquipments: SANATORIO_EQUIPMENTS, fieldbeatClients: SANATORIO_CLIENTS, overrides: [] });
  const unknownResult = results.find(r => r.equipmentKey === "SN:DESCONOCIDO");
  assert.notEqual(unknownResult.matchStatus, "MATCHED");
  assert.notEqual(unknownResult.fieldbeatEquipmentKey, "FB_COMPACT_201110");
});

test("varias versiones contractuales del mismo serial (misma identidad física) resuelven de forma estable al mismo fieldbeat_equipment_key en corridas independientes", () => {
  // Simula 2 corridas de importación distintas en el tiempo para la MISMA
  // identidad física (SN:201110) -cada corrida computa su propio contexto
  // de matching de forma independiente (mismo patrón que import-contracts.js/
  // db-writer.js, una corrida por vez), y ambas deben resolver al mismo
  // equipo real, sin importar qué otros candidatos acompañen a cada corrida.
  const run1 = matchAll([compactCandidate], { fieldbeatEquipments: SANATORIO_EQUIPMENTS, fieldbeatClients: SANATORIO_CLIENTS, overrides: [] });
  const run2 = matchAll([compactCandidate, preciseCandidate], { fieldbeatEquipments: SANATORIO_EQUIPMENTS, fieldbeatClients: SANATORIO_CLIENTS, overrides: [] });

  assert.equal(run1[0].matchStatus, "MATCHED");
  assert.equal(run1[0].fieldbeatEquipmentKey, "FB_COMPACT_201110");
  const run2Compact = run2.find(r => r.equipmentKey === "SN:201110");
  assert.equal(run2Compact.matchStatus, "MATCHED");
  assert.equal(run2Compact.fieldbeatEquipmentKey, "FB_COMPACT_201110");
});
