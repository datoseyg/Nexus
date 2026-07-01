import fs from "node:fs/promises";
import { readCsv, writeCsv } from "../lib/csv.js";
import { resolvePartIdentity } from "../resolvers/part-identity-resolver.js";

const USED_PARTS_FILE = "data/processed/fieldbeat/DB_FieldBeat_Used_Parts.csv";
const IDENTITY_MAP_FILE = "data/processed/dolibarr/DIM_Dolibarr_Product_Identity_Map.csv";
const ALIAS_FILE = "data/config/part_identity_aliases.csv";

const MATCH_FILE = "data/marts/Used_Parts_Dolibarr_Match.csv";
const NO_MATCH_FILE = "data/reports/used_parts_without_dolibarr_match.csv";
const AMBIGUOUS_FILE = "data/reports/used_parts_ambiguous_dolibarr_match.csv";
const REVIEW_QUEUE_FILE = "data/reports/used_parts_manual_review_queue.csv";
const SUMMARY_FILE = "data/reports/dolibarr_parts_match_summary.json";

const REVIEW_QUEUE_SAMPLE_LIMIT = 5;

function percent(numerator, denominator) {
  if (!denominator) return "0.00%";
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

function suggestAction(statuses) {
  if (statuses.has("PLACEHOLDER_VALUE")) {
    return "Valor placeholder (sin numero/serie/N-A). Confirmar que no requiere match real.";
  }

  if (statuses.has("AMBIGUOUS_MATCH")) {
    return "Multiples candidatos Dolibarr. Revisar y agregar alias manual si corresponde.";
  }

  if (statuses.has("NO_MATCH")) {
    return "Sin match en Dolibarr. Buscar producto correcto y agregar alias manual.";
  }

  return "Revisar manualmente.";
}

function buildManualReviewQueue(matchRows) {
  const relevantRows = matchRows.filter(row =>
    row.match_status === "NO_MATCH" ||
    row.match_status === "AMBIGUOUS_MATCH" ||
    row.match_status === "PLACEHOLDER_VALUE" ||
    row.needs_manual_review
  );

  const groups = new Map();

  for (const row of relevantRows) {
    const key = row.normalized_part_identifier || "(vacio)";

    if (!groups.has(key)) {
      groups.set(key, {
        normalized_part_identifier: key,
        rawExamples: new Set(),
        fieldbeatTaskIds: new Set(),
        zendeskTicketIds: new Set(),
        examplePartNames: new Set(),
        statuses: new Set(),
        methods: new Set(),
        occurrences: 0
      });
    }

    const group = groups.get(key);
    group.occurrences += 1;

    if (row.raw_part_identifier) group.rawExamples.add(row.raw_part_identifier);
    if (row.fieldbeat_task_id) group.fieldbeatTaskIds.add(row.fieldbeat_task_id);
    if (row.zendesk_ticket_id) group.zendeskTicketIds.add(row.zendesk_ticket_id);
    if (row.part_name) group.examplePartNames.add(row.part_name);

    group.statuses.add(row.match_status);
    group.methods.add(row.match_method);
  }

  return Array.from(groups.values())
    .map(group => ({
      normalized_part_identifier: group.normalized_part_identifier,
      raw_examples: Array.from(group.rawExamples).slice(0, REVIEW_QUEUE_SAMPLE_LIMIT).join("|"),
      occurrences: group.occurrences,
      fieldbeat_task_ids: Array.from(group.fieldbeatTaskIds).join("|"),
      zendesk_ticket_ids: Array.from(group.zendeskTicketIds).join("|"),
      example_part_names: Array.from(group.examplePartNames).slice(0, REVIEW_QUEUE_SAMPLE_LIMIT).join("|"),
      current_match_status: Array.from(group.statuses).join("|"),
      current_match_method: Array.from(group.methods).join("|"),
      suggested_action: suggestAction(group.statuses),
      manual_dolibarr_product_id: "",
      manual_dolibarr_ref: "",
      review_notes: ""
    }))
    .sort((a, b) => b.occurrences - a.occurrences);
}

async function buildUsedPartsDolibarrMatch() {
  console.log("=== Resolviendo identidad de repuestos FieldBeat <-> Dolibarr ===");

  const usedParts = await readCsv(USED_PARTS_FILE);
  const identityMap = await readCsv(IDENTITY_MAP_FILE);
  const aliasRows = await readCsv(ALIAS_FILE);

  console.log(`Repuestos FieldBeat (used parts): ${usedParts.length}`);
  console.log(`Filas en identity map Dolibarr: ${identityMap.length}`);
  console.log(`Alias manuales cargados: ${aliasRows.length}`);

  const matchRows = usedParts.map(part => {
    const result = resolvePartIdentity(part.part_number, identityMap, aliasRows);

    return {
      used_part_id: part.used_part_id || "",
      fieldbeat_task_id: part.fieldbeat_task_id || "",
      zendesk_ticket_id: part.zendesk_ticket_id || "",
      part_name: part.part_name || "",
      ...result
    };
  });

  await writeCsv(MATCH_FILE, matchRows);

  const matchedRows = matchRows.filter(r => r.match_status === "MATCHED");
  const noMatchRows = matchRows.filter(r => r.match_status === "NO_MATCH");
  const ambiguousRows = matchRows.filter(r => r.match_status === "AMBIGUOUS_MATCH");
  const placeholderRows = matchRows.filter(r => r.match_status === "PLACEHOLDER_VALUE");
  const manualAliasRows = matchRows.filter(r => r.match_method === "MANUAL_ALIAS_EXACT");
  const reviewRequiredRows = matchRows.filter(r => r.needs_manual_review);

  await writeCsv(NO_MATCH_FILE, noMatchRows);
  await writeCsv(AMBIGUOUS_FILE, ambiguousRows);

  const reviewQueueRows = buildManualReviewQueue(matchRows);
  await writeCsv(REVIEW_QUEUE_FILE, reviewQueueRows);

  const methodBreakdown = {};
  const statusBreakdown = {};

  for (const row of matchRows) {
    methodBreakdown[row.match_method] = (methodBreakdown[row.match_method] || 0) + 1;
    statusBreakdown[row.match_status] = (statusBreakdown[row.match_status] || 0) + 1;
  }

  const summary = {
    generated_at: new Date().toISOString(),
    total_used_parts: usedParts.length,
    matched_count: matchedRows.length,
    no_match_count: noMatchRows.length,
    ambiguous_count: ambiguousRows.length,
    placeholder_values_count: placeholderRows.length,
    manual_alias_match_count: manualAliasRows.length,
    review_required_count: reviewRequiredRows.length,
    match_rate: percent(matchedRows.length, usedParts.length),
    placeholder_rate: percent(placeholderRows.length, usedParts.length),
    ambiguous_rate: percent(ambiguousRows.length, usedParts.length),
    match_status_breakdown: statusBreakdown,
    match_method_breakdown: methodBreakdown
  };

  await fs.mkdir("data/reports", { recursive: true });
  await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Resumen guardado en ${SUMMARY_FILE}`);
  console.log(`Cola de revisión manual: ${REVIEW_QUEUE_FILE} (${reviewQueueRows.length} grupos)`);
  console.log("=== Resolución de identidad de repuestos finalizada ===");
}

buildUsedPartsDolibarrMatch().catch(error => {
  console.error("ERROR RESOLVIENDO IDENTIDAD DE REPUESTOS:");
  console.error(error);
  process.exit(1);
});
