import { test } from "node:test";
import assert from "node:assert/strict";
import { matchStatusFinding, matchStatusRecommendation, issueRecommendation } from "../../lib/audit-vocabulary.ts";

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
const KNOWN_MATCH_STATUSES = ["NO_MATCH", "AMBIGUOUS_MATCH", "PLACEHOLDER_VALUE", "MATCHED"];
const KNOWN_RULE_CODES = ["PART_NO_MATCH", "PART_AMBIGUOUS_MATCH", "PART_PLACEHOLDER_VALUE", "REPORT_QUALITY_DEGRADED", "TICKET_LINK_RESTRICTED_OR_MISSING"];

// Códigos/anglicismos internos explícitamente prohibidos como texto visible
// principal (sección 2/17 del encargo) - ninguno debe aparecer, ni siquiera
// como substring, dentro de las etiquetas de negocio generadas.
const FORBIDDEN_RAW_TOKENS = [
  "PLACEHOLDER_REJECTED",
  "REF_LIKE",
  "TICKET_LINK_RESTRICTED_OR_MISSING",
  "PART_NO_MATCH",
  "PART_AMBIGUOUS_MATCH",
  "PART_PLACEHOLDER_VALUE",
  "NO_MATCH",
  "AMBIGUOUS_MATCH",
  "PLACEHOLDER_VALUE"
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
