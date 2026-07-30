import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contractStatusLabel,
  spaTierLabel,
  contractMatchStatusLabel,
  preventiveMaintenanceLabel
} from "../../lib/contracts-vocabulary.ts";

// Sección 12/15 de la corrección de identidad de Equipos - los códigos
// técnicos NUNCA dominan la UI: cada código real (confirmado contra el CHECK
// de sql/070_config.sql) tiene una etiqueta de negocio, y un código no
// mapeado devuelve el crudo tal cual (señal de vocabulario desactualizado,
// nunca una traducción inventada).
test("contractStatusLabel traduce el catálogo real completo, nunca el código crudo", () => {
  assert.equal(contractStatusLabel("ACTIVE_AUTO_RENEW"), "Activo con renovación automática");
  assert.equal(contractStatusLabel("ACTIVE_FIXED_TERM"), "Activo con plazo fijo");
  assert.equal(contractStatusLabel("DEINSTALLED"), "Equipo desinstalado");
  assert.equal(contractStatusLabel("DIRECT_WITH_ELEKTA"), "Contrato directo con Elekta");
  assert.equal(contractStatusLabel("ON_DEMAND"), "Servicio bajo demanda");
  assert.equal(contractStatusLabel("WARRANTY_ELEKTA"), "Garantía Elekta");
  assert.equal(contractStatusLabel("UNKNOWN"), "No informado");
  assert.notEqual(contractStatusLabel("ACTIVE_AUTO_RENEW"), "ACTIVE_AUTO_RENEW");
});

test("contractStatusLabel nunca inventa una traducción para un código no mapeado", () => {
  assert.equal(contractStatusLabel("SOME_FUTURE_CODE"), "SOME_FUTURE_CODE");
});

test("contractStatusLabel/spaTierLabel nunca lanzan con null/undefined/vacío - siempre 'No informado'", () => {
  assert.equal(contractStatusLabel(null), "No informado");
  assert.equal(contractStatusLabel(undefined), "No informado");
  assert.equal(contractStatusLabel(""), "No informado");
  assert.equal(spaTierLabel(null), "No informado");
});

// match_status: la UI NUNCA muestra MATCHED/UNMATCHED/AMBIGUOUS como etiqueta
// principal (sección 10) - siempre en lenguaje de negocio.
test("contractMatchStatusLabel usa lenguaje de negocio, nunca el código técnico", () => {
  assert.equal(contractMatchStatusLabel("MATCHED"), "Vinculado con FieldBeat");
  assert.equal(contractMatchStatusLabel("UNMATCHED"), "Sin vincular");
  assert.equal(contractMatchStatusLabel("AMBIGUOUS"), "Vinculación por confirmar");
  for (const code of ["MATCHED", "UNMATCHED", "AMBIGUOUS"]) {
    assert.notEqual(contractMatchStatusLabel(code), code);
  }
});

// preventiveMaintenanceLabel es la ÚNICA cifra contractual real con
// unidad/periodo propios (no existe un campo de "horas contractuales" en la
// fuente, ver lib/contracts-vocabulary.ts) - NUNCA debe mostrar un número
// desnudo sin su unidad ("/ año"), y una regla textual real (ej. "Por cada
// cambio de fuente") se conserva tal cual, nunca se descarta.
test("preventiveMaintenanceLabel siempre incluye la unidad/periodo, nunca un número desnudo", () => {
  assert.equal(preventiveMaintenanceLabel(2, 2, null), "2 mantenimientos preventivos / año");
  assert.equal(preventiveMaintenanceLabel(1, 1, null), "1 mantenimiento preventivo / año");
  assert.equal(preventiveMaintenanceLabel(2, 4, null), "2-4 mantenimientos preventivos / año");
  assert.match(preventiveMaintenanceLabel(2, 2, null), /año/);
});

test("preventiveMaintenanceLabel conserva una regla textual real tal cual, nunca la descarta", () => {
  assert.equal(preventiveMaintenanceLabel(null, null, "Por cada cambio de fuente"), "Por cada cambio de fuente");
});

test("preventiveMaintenanceLabel sin datos devuelve 'No informado', nunca 0 ni un valor fabricado", () => {
  assert.equal(preventiveMaintenanceLabel(null, null, null), "No informado");
});
