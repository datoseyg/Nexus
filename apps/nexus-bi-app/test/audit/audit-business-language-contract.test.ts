import { test } from "node:test";
import assert from "node:assert/strict";
import { matchStatusFinding, matchStatusRecommendation, issueRecommendation } from "../../lib/audit-vocabulary.ts";
import { CATALOG_MATCH_STATUS_LABEL } from "../../lib/fieldbeat-report-labels.ts";

// Nota: components/ui/StatusBadge.tsx no se importa acá a propósito - es un
// componente .tsx con JSX real (no solo tipos), y la suite corre con
// `node --experimental-strip-types` (ver test/ts-extension-loader.mjs), que
// solo elimina anotaciones de tipo, no transforma JSX. matchStatusBadge()
// se prueba indirectamente por su consumo en PartsReviewSection - este
// archivo cubre el módulo de vocabulario puro (lib/audit-vocabulary.ts),
// que es el "único módulo de presentación" pedido por el encargo.

// Contrato de negocio (sección 17 de la corrección de negocio de
// Auditoría): ningún código técnico interno puede volver a dominar la UI
// como si fuera la etiqueta principal de una fila. Estos códigos son un
// catálogo cerrado (marts.used_parts_dolibarr_match.match_status,
// governance.rule_definitions.rule_code) - este test fija que las
// funciones de presentación de negocio NUNCA devuelven el código crudo tal
// cual para un valor conocido/mapeado. Un código fuera del catálogo cae al
// texto ya provisto por el backend (rule_title) - eso no es un fallo de
// este contrato, es el comportamiento honesto documentado en
// lib/audit-vocabulary.ts.
const KNOWN_MATCH_STATUSES = ["NO_MATCH", "AMBIGUOUS_MATCH", "PLACEHOLDER_VALUE", "MATCHED", "NO_PART_USED"];
const KNOWN_RULE_CODES = ["PART_NO_MATCH", "PART_AMBIGUOUS_MATCH", "PART_PLACEHOLDER_VALUE", "REPORT_QUALITY_DEGRADED", "TICKET_LINK_RESTRICTED_OR_MISSING"];

// Códigos/anglicismos internos explícitamente prohibidos como texto visible
// principal (sección 2/17 del encargo) - ninguno debe aparecer, ni siquiera
// como substring, dentro de las etiquetas de negocio generadas. RAW/
// NORMALIZED (y la clasificación técnica NO_PART_USED) se agregan por el
// pedido "clasificar sin repuesto" - ningún término técnico de alias o de
// clasificación de repuesto puede filtrarse a una etiqueta de negocio.
const FORBIDDEN_RAW_TOKENS = [
  "PLACEHOLDER_REJECTED",
  "REF_LIKE",
  "TICKET_LINK_RESTRICTED_OR_MISSING",
  "PART_NO_MATCH",
  "PART_AMBIGUOUS_MATCH",
  "PART_PLACEHOLDER_VALUE",
  "NO_MATCH",
  "AMBIGUOUS_MATCH",
  "PLACEHOLDER_VALUE",
  "NO_PART_USED",
  "RAW",
  "NORMALIZED"
];

function assertNoForbiddenToken(text: string, context: string) {
  for (const token of FORBIDDEN_RAW_TOKENS) {
    assert.ok(!text.includes(token), `${context} contiene el código crudo "${token}": "${text}"`);
  }
}

test("matchStatusFinding nunca devuelve el código crudo para un match_status conocido", () => {
  for (const status of KNOWN_MATCH_STATUSES) {
    const finding = matchStatusFinding(status);
    assert.notEqual(finding, status);
    assertNoForbiddenToken(finding, `matchStatusFinding(${status})`);
  }
});

test("matchStatusRecommendation nunca expone el código crudo en su texto de recomendación", () => {
  for (const status of KNOWN_MATCH_STATUSES) {
    const rec = matchStatusRecommendation(status);
    assertNoForbiddenToken(rec.text, `matchStatusRecommendation(${status}).text`);
    assertNoForbiddenToken(rec.actionLabel, `matchStatusRecommendation(${status}).actionLabel`);
  }
});

test("issueRecommendation nunca expone rule_code crudo en hallazgo/recomendación para una regla conocida", () => {
  for (const ruleCode of KNOWN_RULE_CODES) {
    const rec = issueRecommendation(ruleCode);
    assert.notEqual(rec.finding, ruleCode);
    assert.notEqual(rec.recommendation, ruleCode);
    assertNoForbiddenToken(rec.finding, `issueRecommendation(${ruleCode}).finding`);
    assertNoForbiddenToken(rec.recommendation, `issueRecommendation(${ruleCode}).recommendation`);
    assertNoForbiddenToken(rec.actionLabel, `issueRecommendation(${ruleCode}).actionLabel`);
  }
});

test("issueRecommendation para una regla desconocida cae al título provisto, nunca fabrica un código", () => {
  const rec = issueRecommendation("SOME_FUTURE_RULE_CODE", "Nombre de negocio real");
  assert.equal(rec.finding, "Nombre de negocio real");
  assertNoForbiddenToken(rec.recommendation, "issueRecommendation(unknown).recommendation");
});

// Superficie del drawer/PDF de reportes FieldBeat (FieldbeatReportDetailContent.tsx,
// lib/fieldbeat-report-pdf.ts) - CATALOG_MATCH_STATUS_LABEL es un
// Record<string, string> (claves abiertas, no un union cerrado), así que un
// valor real como NO_PART_USED sin entrada en el mapa NO falla en
// compilación - cae en silencio al `?? p.catalogMatchStatus` del renderer y
// muestra el código crudo. Esta prueba es la única red que detecta esa
// omisión (encontrada realmente: la vista SQL ya devolvía NO_PART_USED
// antes de que este mapa tuviera la entrada correspondiente).
test("CATALOG_MATCH_STATUS_LABEL tiene entrada de negocio para NO_PART_USED, nunca cae al código crudo", () => {
  assert.equal(CATALOG_MATCH_STATUS_LABEL.NO_PART_USED, "Sin repuesto utilizado");
});

// Decisión de dominio (sql/098): NO_PART_USED es una declaración válida de
// cero repuestos, nunca un placeholder que requiera intervención humana -
// el hallazgo debe ser el texto de negocio exacto y la recomendación nunca
// puede sonar accionable (nunca "Resolver"/"Confirmar"/"Revisar opciones").
test("matchStatusFinding('NO_PART_USED') es 'Sin repuesto utilizado', nunca un placeholder", () => {
  assert.equal(matchStatusFinding("NO_PART_USED"), "Sin repuesto utilizado");
});

test("matchStatusRecommendation('NO_PART_USED') nunca pide una acción humana", () => {
  const rec = matchStatusRecommendation("NO_PART_USED");
  const ACTIONABLE_LABELS = ["Resolver", "Confirmar", "Revisar opciones", "Validar"];
  assert.ok(
    !ACTIONABLE_LABELS.includes(rec.actionLabel),
    `matchStatusRecommendation('NO_PART_USED').actionLabel ("${rec.actionLabel}") suena accionable - NO_PART_USED nunca debe pedir revisión manual`
  );
});

// RAW/NORMALIZED (sql y enum internos de manual_review.part_aliases.alias_type)
// nunca pueden aparecer como texto visible - se traducen a "Solo esta
// escritura exacta"/"También escrituras equivalentes" en
// PartAliasCorrectionDrawer.tsx y CorreccionesSection.tsx. Ambos son
// componentes .tsx con JSX real y no se pueden importar en esta suite (ver
// nota superior), así que se escanea el código fuente directamente. Un
// escaneo genérico ">texto<" es demasiado frágil en un .tsx real (TS trae
// sus propios ">"/"<" en `=>`, genéricos, comparadores) - en vez de eso se
// prueba (a) que la forma literal del defecto original ya corregido
// ("RAW (" / "NORMALIZED (", como en el viejo <option>RAW (código crudo
// exacto)</option>) no reaparece, y (b) que el reemplazo de negocio
// esperado sigue presente - juntas cubren la regresión real reportada.
test("PartAliasCorrectionDrawer y CorreccionesSection nunca muestran 'RAW ('/'NORMALIZED (' (forma del defecto original)", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const files = [
    path.resolve(import.meta.dirname, "../../components/audit/PartAliasCorrectionDrawer.tsx"),
    path.resolve(import.meta.dirname, "../../components/audit/CorreccionesSection.tsx")
  ];
  for (const file of files) {
    const rawSource = await fs.readFile(file, "utf8");
    // Quita comentarios (incluye {/* JSX */}) antes de revisar - un
    // comentario de código que documenta la decisión ("Default NORMALIZED
    // (...)") no es texto visible y no debe contar como regresión.
    const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!source.includes("RAW ("), `${file} contiene "RAW (" - forma del defecto original ya corregido`);
    assert.ok(!source.includes("NORMALIZED ("), `${file} contiene "NORMALIZED (" - forma del defecto original ya corregido`);
    assert.ok(!source.includes(">RAW<"), `${file} contiene ">RAW<" - código crudo como texto JSX directo`);
    assert.ok(!source.includes(">NORMALIZED<"), `${file} contiene ">NORMALIZED<" - código crudo como texto JSX directo`);
  }
});

test("PartAliasCorrectionDrawer usa el vocabulario de negocio esperado para el alcance de la corrección", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const source = await fs.readFile(path.resolve(import.meta.dirname, "../../components/audit/PartAliasCorrectionDrawer.tsx"), "utf8");
  assert.ok(source.includes("Solo esta escritura exacta"), "falta la etiqueta de negocio para RAW");
  assert.ok(source.includes("También escrituras equivalentes"), "falta la etiqueta de negocio para NORMALIZED");
  assert.ok(source.includes('useState<AliasType>("NORMALIZED")'), "el valor por defecto debe ser NORMALIZED (identificadores equivalentes) para valores tipo identificador");
});
