// Vocabulario de negocio para Contratos - traduce los códigos técnicos de
// config.contract_equipment_versions/matches (catálogos cerrados vía CHECK,
// sql/070_config.sql) a etiquetas legibles. Mismo criterio que
// lib/audit-vocabulary.ts: cada mapa es exhaustivo contra su CHECK real
// (confirmado por lectura de sql/070_config.sql) - un valor no mapeado
// devuelve el código crudo tal cual (nunca inventa una traducción), señal de
// que este archivo quedó atrás de una migración nueva.
//
// spa_tier_code se conserva como nombre comercial ("Plan Gold", "Garantía
// Gold") en vez de traducirse palabra por palabra - son planes reales de
// EyG/Elekta, no un estado técnico. Inferidos del propio nombre del código
// (GOLD/SILVER/WARRANTY_*) - no verificados contra un glosario comercial
// independiente; ajustar acá si el nombre real difiere.

export const CONTRACT_STATUS_LABELS: Record<string, string> = {
  ACTIVE_AUTO_RENEW: "Activo con renovación automática",
  ACTIVE_FIXED_TERM: "Activo con plazo fijo",
  WARRANTY_ELEKTA: "Garantía Elekta",
  DIRECT_WITH_ELEKTA: "Contrato directo con Elekta",
  NO_CONTRACT: "Sin contrato",
  ON_DEMAND: "Servicio bajo demanda",
  DEINSTALLED: "Equipo desinstalado",
  UNKNOWN: "No informado"
};

export const SPA_TIER_LABELS: Record<string, string> = {
  GOLD: "Plan Gold",
  WARRANTY_FULL: "Garantía completa",
  SILVER: "Plan Silver",
  WARRANTY_GOLD: "Garantía Gold",
  NO_SPA: "Sin plan SPA",
  SILVER_WITH_SOURCES: "Plan Silver (con fuentes)",
  SILVER_NO_SOURCE: "Plan Silver (sin fuente)",
  UNKNOWN: "No informado"
};

export const SUPPORT_MODE_LABELS: Record<string, string> = {
  ONSITE_AND_REMOTE: "Presencial y remoto",
  REMOTE: "Solo remoto",
  NOT_APPLICABLE: "No aplica",
  UNKNOWN: "No informado"
};

export const PARTS_COVERAGE_LABELS: Record<string, string> = {
  FULL_COVERAGE: "Cobertura completa de repuestos",
  PARTIAL_EXCLUDES_PANELS_MAGNETRON_THYRATRON: "Cobertura parcial (excluye paneles/magnetrón/thyratrón)",
  NOT_INCLUDED: "Repuestos no incluidos",
  PARTIAL_UNDER_THRESHOLD: "Cobertura parcial (bajo un umbral)",
  UNKNOWN: "No informado"
};

// hw_refresh_code/updates_code/upgrades_code comparten el mismo catálogo.
export const CONTRACT_FEATURE_LABELS: Record<string, string> = {
  YES: "Incluido",
  NO: "No incluido",
  SW_ONLY: "Solo software",
  CONDITIONAL_SW: "Software, con condiciones",
  UNKNOWN: "No informado"
};

// config.contract_equipment_matches.match_status - lenguaje de negocio
// siempre, nunca el código técnico como etiqueta principal (ver
// components/explorer, ExplorerDetailDrawer).
export const CONTRACT_MATCH_STATUS_LABELS: Record<string, string> = {
  MATCHED: "Vinculado con FieldBeat",
  UNMATCHED: "Sin vincular",
  AMBIGUOUS: "Vinculación por confirmar"
};

export const CONTRACT_MATCH_METHOD_LABELS: Record<string, string> = {
  OVERRIDE: "Vínculo manual",
  SERIAL_SUFFIX: "Vínculo por número de serie",
  CLIENT_SITE_MODEL: "Vínculo por cliente/sede/modelo",
  NONE: "Sin método"
};

export const INSTALLATION_DATE_PRECISION_LABELS: Record<string, string> = {
  MONTH: "Mes exacto",
  YEAR: "Solo año",
  UNKNOWN: "Desconocida"
};

// contract_service_schedules.coverage_type - horario/cobertura real (no
// existe en la fuente un campo de "horas contractuales" con unidad propia,
// ver docs de la corrección de identidad de Equipos - Q_MANT_PREV_ANIO es lo
// más cercano a una cifra con unidad/periodo real, ver
// PREVENTIVE_MAINTENANCE_RULE_LABEL más abajo).
export const COVERAGE_TYPE_LABELS: Record<string, string> = {
  FULL_24X7: "24/7 completo",
  CRITICAL_ONLY_24X7: "24/7 solo crítico",
  FIXED_WINDOW: "Ventana horaria fija",
  BUSINESS_HOURS_UNDEFINED: "Horario hábil (sin definir)",
  ON_DEMAND: "Bajo demanda",
  NOT_COVERED: "Sin cobertura",
  NOT_APPLICABLE: "No aplica",
  UNKNOWN: "No informado"
};

function labelOr(map: Record<string, string>, code: unknown): string {
  if (code === null || code === undefined || code === "") return "No informado";
  return map[String(code)] ?? String(code);
}

export function contractStatusLabel(code: unknown): string {
  return labelOr(CONTRACT_STATUS_LABELS, code);
}
export function spaTierLabel(code: unknown): string {
  return labelOr(SPA_TIER_LABELS, code);
}
export function supportModeLabel(code: unknown): string {
  return labelOr(SUPPORT_MODE_LABELS, code);
}
export function partsCoverageLabel(code: unknown): string {
  return labelOr(PARTS_COVERAGE_LABELS, code);
}
export function contractFeatureLabel(code: unknown): string {
  return labelOr(CONTRACT_FEATURE_LABELS, code);
}
export function contractMatchStatusLabel(code: unknown): string {
  return labelOr(CONTRACT_MATCH_STATUS_LABELS, code);
}
export function contractMatchMethodLabel(code: unknown): string {
  return labelOr(CONTRACT_MATCH_METHOD_LABELS, code);
}
export function coverageTypeLabel(code: unknown): string {
  return labelOr(COVERAGE_TYPE_LABELS, code);
}

// Q Mant Prev x Año (preventive_maintenance_min/max/rule) - la ÚNICA cifra
// contractual real con unidad/periodo propios en la fuente (data/manual/
// contracts/*.csv, ver src/contracts/field-map.js y
// normalize-preventive-maintenance.js). NO existe en ningún archivo/tabla de
// origen un campo de "horas contractuales" (ni por mes, año o trimestre) -
// confirmado leyendo el layout posicional completo del CSV real
// (src/contracts/field-map.js) y el esquema de config.contract_equipment_versions
// (sql/070_config.sql): las únicas cifras con unidad real son esta
// (mantenimientos preventivos/año) y los booleanos weekday_service/
// weekend_service + coverage_type (ventanas horarias, no un total de horas).
// Mostrar "N mantenimientos preventivos/año" en vez de inventar una cifra de
// horas que no existe en los datos.
export function preventiveMaintenanceLabel(min: unknown, max: unknown, rule: unknown): string {
  if (typeof rule === "string" && rule.trim()) return rule;
  const minNum = typeof min === "number" ? min : null;
  const maxNum = typeof max === "number" ? max : null;
  if (minNum === null && maxNum === null) return "No informado";
  if (minNum !== null && maxNum !== null && minNum === maxNum) return `${minNum} mantenimiento${minNum === 1 ? "" : "s"} preventivo${minNum === 1 ? "" : "s"} / año`;
  if (minNum !== null && maxNum !== null) return `${minNum}-${maxNum} mantenimientos preventivos / año`;
  return `${minNum ?? maxNum} mantenimiento(s) preventivo(s) / año (aprox.)`;
}
