import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// lib/explorer-filters-config.ts importa severityBadge/issueStatusBadge de
// components/ui/StatusBadge.tsx (React) - el loader de type-stripping de
// node:test no resuelve ".tsx" transitivamente, así que estas pruebas
// escanean el CÓDIGO FUENTE como texto en vez de importar el módulo (mismo
// patrón ya establecido en test/auth/auth-wiring.test.ts para guardas
// equivalentes) - evita el problema de import por completo y es igual de
// válido para una prueba de "esta clave nunca aparece".
async function source(path: string): Promise<string> {
  return readFile(path, "utf8");
}

// Los propios comentarios de este archivo (y de explorer-sql.ts) MENCIONAN
// part_usage_status/requires_review/cost_price en prosa para documentar por
// qué están excluidos deliberadamente - una prueba que buscara el string en
// TODO el archivo se rompería contra su propia documentación. Se descarta
// cada línea `//` completa antes de buscar (mismo criterio que un linter:
// nunca evalúa comentarios como código).
function stripLineComments(code: string): string {
  return code
    .split("\n")
    .map(line => {
      const idx = line.indexOf("//");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

// Guarda contra la regresión exacta que el encargo pidió evitar
// explícitamente: "no inventes filtros ni enums". part_usage_status y
// requires_review NO son columnas reales de repuestos en ningún lado de
// este codebase (requires_review solo existe en
// config.contract_equipment_versions, dominio de Contratos) - si algún
// cambio futuro las agrega como filtro de Repuestos sin verificar primero
// que la columna es real, esta prueba debe fallar.
test("parts nunca declara los filtros part_usage_status/requires_review (no existen como columnas reales)", async () => {
  const filtersConfig = stripLineComments(await source("lib/explorer-filters-config.ts"));
  assert.doesNotMatch(filtersConfig, /part_usage_status/);
  assert.doesNotMatch(filtersConfig, /requires_review/);
});

// cost_price es "EXCLUIDO SIEMPRE" (dato comercialmente sensible, ver
// explorer-sql.ts) - nunca debe aparecer como filtro, columna de listado ni
// campo de detalle de Productos, ni seleccionarse en ninguna consulta SQL
// de esa entidad (fuera de su propio comentario explicativo).
test("products nunca expone cost_price como filtro, columna de listado, campo de detalle o columna SQL seleccionada", async () => {
  const filtersConfig = stripLineComments(await source("lib/explorer-filters-config.ts"));
  assert.doesNotMatch(filtersConfig, /costPrice/);

  const entityConfig = stripLineComments(await source("lib/explorer-entity-config.ts"));
  assert.doesNotMatch(entityConfig, /cost_price/);

  const explorerSql = stripLineComments(await source("lib/explorer-sql.ts"));
  assert.doesNotMatch(explorerSql, /cost_price/, "ninguna consulta de Productos debe seleccionar cost_price, ni siquiera en el detalle");
});

// Contrato unificado de filtros (sección 14) - todo filtro "boolean" declara
// exactamente las opciones Sí/No vía YES_NO_OPTIONS (tri-estado real:
// Todos/Sí/No), nunca un checkbox binario donde "sin marcar" se confunda
// con "No". Escaneo de texto: cada `kind: "boolean"` debe ir acompañado de
// `staticOptions: YES_NO_OPTIONS` en la misma definición.
test("todo filtro kind:\"boolean\" usa YES_NO_OPTIONS (tri-estado Todos/Sí/No, nunca un checkbox binario)", async () => {
  const filtersConfig = await source("lib/explorer-filters-config.ts");
  const booleanDefLines = filtersConfig.split("\n").filter(line => line.includes('kind: "boolean"'));
  assert.ok(booleanDefLines.length > 0, "debería haber al menos un filtro boolean declarado");
  for (const line of booleanDefLines) {
    assert.match(line, /staticOptions: YES_NO_OPTIONS/, `filtro boolean sin YES_NO_OPTIONS: ${line.trim()}`);
  }
});
