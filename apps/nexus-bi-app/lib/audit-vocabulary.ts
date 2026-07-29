// Vocabulario de negocio para Auditoría - traduce los códigos técnicos del
// esquema de gobierno (event_type/correction_type/entity_type/actor_type/
// verification_outcome/etc., todos catálogos cerrados y versionados en
// sql/089-097) a etiquetas legibles. rule_code es la única excepción: su
// nombre de negocio vive en governance.rule_definitions.title (columna real,
// ya corregida para coincidir con este vocabulario) - se consulta ahí, nunca
// se duplica acá, para tener una sola fuente de verdad.
//
// Cada mapa es exhaustivo contra su catálogo real (confirmado por lectura de
// las semillas SQL) - un valor no mapeado devuelve el código crudo tal cual
// (nunca inventa una traducción), señal de que este archivo quedó atrás de
// una migración nueva.

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  part_occurrence: "Repuesto declarado",
  report: "Reporte",
  ticket_link: "Vínculo de ticket"
};

export const CORRECTION_TYPE_LABELS: Record<string, string> = {
  "part-alias": "Alias de repuesto",
  "technician-identity": "Identidad de técnico",
  "ticket-link": "Vínculo de ticket",
  "equipment-identification": "Identificación de equipo"
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  ISSUE_DETECTED: "Incidencia detectada",
  ISSUE_REAPPEARED: "Incidencia reaparecida",
  ISSUE_ASSIGNED: "Revisión iniciada",
  ISSUE_DISMISSED: "Incidencia descartada",
  ISSUE_REOPENED: "Incidencia reabierta",
  ISSUE_RESOLVED_VERIFIED: "Incidencia resuelta (verificada)",
  COMMENT_ADDED: "Comentario agregado",
  COMMENT_REDACTED: "Comentario redactado",
  CORRECTION_APPLIED: "Corrección aplicada",
  CORRECTION_REVERSED: "Corrección revertida",
  VERIFICATION_PASSED: "Verificación aprobada",
  VERIFICATION_STILL_DETECTED: "Verificación: problema persiste",
  VERIFICATION_OPERATIONAL_ERROR: "Verificación: error operacional",
  VERIFICATION_DEAD_LETTERED: "Verificación: reintentos agotados",
  REVIEW_CASE_CREATED: "Caso creado",
  REVIEW_CASE_UPDATED: "Caso actualizado",
  LEGACY_CORRECTION_IMPORTED: "Corrección histórica migrada",
  EXPORT_COMPLETED: "Exportación completada",
  RESTRICTED_EVIDENCE_ACCESSED: "Evidencia restringida consultada",
  REDACTED_COMMENT_ACCESSED: "Comentario redactado consultado",
  RESTRICTED_EVENT_STATE_ACCESSED: "Estado restringido de evento consultado"
};

export const EVIDENCE_TYPE_LABELS: Record<string, string> = {
  RULE_DETECTION: "Detección de regla",
  CORRECTION_VERIFICATION: "Verificación de corrección"
};

// governance.command_events.command_type - closed set emitida por las
// funciones de comando (sql/090-097), confirmado por lectura de cada
// `jsonb_build_object('commandType', ...)`/`INSERT ... command_events`.
export const COMMAND_TYPE_LABELS: Record<string, string> = {
  "correction:part-alias": "Alias de repuesto",
  "correction:technician-identity": "Identidad de técnico",
  "correction:ticket-link": "Vínculo de ticket",
  "correction:equipment-identification": "Identificación de equipo",
  "correction:reverse": "Reversión de corrección",
  "review-case:create": "Creación de caso",
  "review-case:assign": "Asignación de caso",
  "review-case:comment": "Comentario en caso",
  "review-case:redact-comment": "Redacción de comentario",
  "review-case:close": "Cierre de caso",
  "review-case:reopen": "Reapertura de caso",
  "review-case:add-issue": "Incidencia agregada a caso",
  "review-case:end-membership": "Incidencia quitada de caso",
  "issue:start-review": "Inicio de revisión",
  "issue:dismiss": "Descarte de incidencia",
  "issue:reopen": "Reapertura de incidencia",
  "audit:evidence-restricted": "Acceso a contenido restringido",
  export: "Exportación"
};

export const ACTOR_TYPE_LABELS: Record<string, string> = {
  HUMAN: "Persona",
  SERVICE: "Sistema",
  LEGACY_UNVERIFIED: "Histórico sin verificar"
};

export const VERIFICATION_PROCESSING_STATUS_LABELS: Record<string, string> = {
  PENDING: "Verificación pendiente",
  RUNNING: "Verificando",
  COMPLETED: "Verificación completada",
  CANCELLED: "Verificación cancelada",
  DEAD_LETTERED: "Verificación con error persistente"
};

export const VERIFICATION_OUTCOME_LABELS: Record<string, string> = {
  PASSED: "Aprobada - problema resuelto",
  STILL_DETECTED: "Problema persiste",
  OPERATIONAL_ERROR: "Error operacional"
};

export const MEMBERSHIP_END_REASON_LABELS: Record<string, string> = {
  REMOVED_BY_ACTOR: "Quitada manualmente",
  CASE_CLOSED: "Caso resuelto",
  CASE_DISMISSED: "Caso descartado"
};

export const EVALUATION_RUN_STATUS_LABELS: Record<string, string> = {
  RUNNING: "En ejecución",
  SUCCEEDED: "Completada",
  PARTIAL_FAILED_NOT_PUBLISHED: "Falla parcial (sin publicar)",
  FAILED: "Fallida",
  SUPERSEDED_NOT_PUBLISHED: "Reemplazada (sin publicar)",
  CANCELLED: "Cancelada"
};

export const EVALUATION_SCOPE_MODE_LABELS: Record<string, string> = {
  FULL: "Universo completo",
  INCREMENTAL_SINCE_LAST_REFRESH: "Incremental desde la última actualización",
  SCOPED: "Acotada a una regla/entidad"
};

export const EVALUATION_TRIGGERED_BY_LABELS: Record<string, string> = {
  BATCH_SCHEDULE: "Programada",
  DATA_REFRESH_PUBLISH: "Tras actualización de datos",
  MANUAL_ADMIN: "Manual (Administración)",
  CORRECTION_VERIFICATION: "Verificación de corrección"
};

function labelOrRaw(map: Record<string, string>, code: string | null | undefined): string {
  if (!code) return "-";
  return map[code] ?? code;
}

export function entityTypeLabel(code: string | null | undefined): string {
  return labelOrRaw(ENTITY_TYPE_LABELS, code);
}

export function correctionTypeLabel(code: string | null | undefined): string {
  return labelOrRaw(CORRECTION_TYPE_LABELS, code);
}

export function eventTypeLabel(code: string | null | undefined): string {
  return labelOrRaw(EVENT_TYPE_LABELS, code);
}

export function commandTypeLabel(code: string | null | undefined): string {
  return labelOrRaw(COMMAND_TYPE_LABELS, code);
}

export function evidenceTypeLabel(code: string | null | undefined): string {
  return labelOrRaw(EVIDENCE_TYPE_LABELS, code);
}

export function actorTypeLabel(code: string | null | undefined): string {
  return labelOrRaw(ACTOR_TYPE_LABELS, code);
}

export function verificationProcessingStatusLabel(code: string | null | undefined): string {
  return labelOrRaw(VERIFICATION_PROCESSING_STATUS_LABELS, code);
}

export function verificationOutcomeLabel(code: string | null | undefined): string {
  return labelOrRaw(VERIFICATION_OUTCOME_LABELS, code);
}

export function membershipEndReasonLabel(code: string | null | undefined): string {
  return labelOrRaw(MEMBERSHIP_END_REASON_LABELS, code);
}

export function evaluationRunStatusLabel(code: string | null | undefined): string {
  return labelOrRaw(EVALUATION_RUN_STATUS_LABELS, code);
}

export function evaluationScopeModeLabel(code: string | null | undefined): string {
  return labelOrRaw(EVALUATION_SCOPE_MODE_LABELS, code);
}

export function evaluationTriggeredByLabel(code: string | null | undefined): string {
  return labelOrRaw(EVALUATION_TRIGGERED_BY_LABELS, code);
}
