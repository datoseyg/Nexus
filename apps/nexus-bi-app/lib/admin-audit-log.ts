import { runQuery } from "./db";

// Reusado por las rutas CRUD de manual_review.* (part-aliases,
// ticket-link-overrides) para dejar rastro de cada escritura exitosa,
// con el mismo espíritu de trazabilidad que curation_audit_log.example.csv
// (rama cloud-d1-readonly) - sin crear una tabla nueva, reutilizando
// audit.data_quality_events que ya existe para este propósito.
export async function logManualReviewAction(params: {
  entityId: string;
  issueType: "CREATED" | "UPDATED" | "DEACTIVATED";
  details: Record<string, unknown>;
}): Promise<void> {
  await runQuery(
    `INSERT INTO audit.data_quality_events (entity_type, entity_id, issue_type, severity, details)
     VALUES ('manual_review_action', $1, $2, 'INFO', $3)`,
    [params.entityId, params.issueType, JSON.stringify(params.details)]
  );
}
