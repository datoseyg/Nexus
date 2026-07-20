import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELDBEAT_UNAVAILABLE_SECTIONS } from "../../lib/fieldbeat-unavailable-sections.ts";

// ETAPA 5-V - las 4 secciones "no disponible" reproducidas en su posición
// original del mockup (evolución, tipo de tarea, cruce cliente×máquina,
// cruce cliente×tipo de tarea). Nunca contienen una cifra copiada del
// mockup (ej. "11 categorías de tarea confirmadas") - esa cifra nunca fue
// verificada contra un contrato real.

test("FIELDBEAT_UNAVAILABLE_SECTIONS: exactamente 4 secciones, claves únicas", () => {
  assert.equal(FIELDBEAT_UNAVAILABLE_SECTIONS.length, 4);
  const keys = new Set(FIELDBEAT_UNAVAILABLE_SECTIONS.map(s => s.key));
  assert.equal(keys.size, 4);
});

test("FIELDBEAT_UNAVAILABLE_SECTIONS: título/subtítulo/razón no vacíos en las 4", () => {
  for (const section of FIELDBEAT_UNAVAILABLE_SECTIONS) {
    assert.ok(section.title.length > 0);
    assert.ok(section.subtitle.length > 0);
    assert.ok(section.reason.length > 0);
  }
});

test("FIELDBEAT_UNAVAILABLE_SECTIONS: ninguna razón contiene una cifra (nunca una cantidad copiada del mockup sin verificar)", () => {
  for (const section of FIELDBEAT_UNAVAILABLE_SECTIONS) {
    assert.equal(/\d/.test(section.reason), false, `la razón de "${section.key}" no debe contener dígitos: "${section.reason}"`);
  }
});

test("FIELDBEAT_UNAVAILABLE_SECTIONS: nunca usa lenguaje de promesa futura ('Próximamente'/'En construcción'/'Disponible pronto')", () => {
  const forbidden = /pr[oó]ximamente|en construcci[oó]n|disponible pronto/i;
  for (const section of FIELDBEAT_UNAVAILABLE_SECTIONS) {
    assert.equal(forbidden.test(section.reason), false);
    assert.equal(forbidden.test(section.title), false);
  }
});
