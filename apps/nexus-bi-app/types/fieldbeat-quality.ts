// Contrato de /api/dashboard/fieldbeat/{overview,quality} (Phase 2). Todo
// campo numérico llega YA coercionado a number (a diferencia de
// types/fieldbeat.ts, que preserva strings BIGINT crudos) - estas rutas
// nuevas devuelven agregados ya calculados en SQL (COUNT/FILTER), nunca
// filas crudas, así que no hay ambigüedad de precisión que preservar.
import type { InconsistencyCode, InconsistencySeverity } from "@/lib/fieldbeat-inconsistency-taxonomy";
import type { equipmentIdentificationStatus } from "@/lib/fieldbeat-equipment-identification";
import type { KnownReportQualityStatus } from "./fieldbeat";

export const FIELDBEAT_QUALITY_CONTRACT_VERSION = "2.0.0";

// Extiende (aditivo) el contrato viejo de /api/dashboard/fieldbeat/filters -
// clientes/tiposTarea/equipos/origenes/dateRange siguen igual, estos son
// los campos nuevos que necesita la barra de filtros v2 (Phase 3 §5).
export interface FieldbeatQualityFilterOptions {
  clientes: string[];
  tiposTarea: string[];
  equipos: string[];
  origenes: string[];
  dateRange: { min: string | null; max: string | null };
  tecnicos: string[];
  qualityStatuses: readonly KnownReportQualityStatus[];
  inconsistencyCodes: readonly InconsistencyCode[];
  severities: readonly InconsistencySeverity[];
  ticketStatuses: readonly ["accessible", "missing_or_restricted", "none"];
  partStatuses: readonly ["fully_traceable", "contains_placeholder", "contains_no_match", "contains_ambiguous"];
}

// Metadata compartida por overview y quality - nunca se declara un universo
// temporal distinto entre ambos endpoints sin decirlo explícitamente acá
// (Gate C Phase 2 §8).
export interface FieldbeatQualityUniverseMetadata {
  generatedAt: string; // ISO 8601, hora de generación de la respuesta
  contractVersion: string;
  effectiveDateFrom: string | null;
  effectiveDateTo: string | null;
  filtersApplied: Record<string, string>;
}

export interface Kpi1StructuralCompleteness {
  numerator: number;
  denominator: number;
  percentage: number | null; // null cuando denominator=0, nunca NaN/Infinity
  missingTechnician: number;
  missingClient: number;
  missingEquipment: number;
  multipleMissing: number;
  drillDownFilter: { qualityStatus: null; note: string };
}

export interface Kpi2TicketLinkage {
  reportsWithAccessibleTicket: number;
  reportsWithMissingOrRestrictedTicket: number;
  reportsWithoutReportedTicket: number;
  evaluableReports: number; // accessible + missingOrRestricted, NUNCA incluye "sin ticket"
  percentage: number | null;
  distributionByTicketCount: Array<{ accessibleTicketCount: number; reportCount: number }>;
  drillDownFilter: { ticketStatus: "accessible" | "missing_or_restricted" };
}

export interface Kpi3equipmentIdentification {
  numerator: number; // structured + textConfident
  denominator: number;
  percentage: number | null;
  structured: number;
  textConfident: number;
  textAmbiguous: number;
  missing: number;
  notApplicable: number;
  sumMatchesDenominator: boolean; // invariante explícita, nunca oculta
  drillDownFilter: { equipmentIdentificationStatus: equipmentIdentificationStatus };
}

export interface Kpi4PartsTraceability {
  reportGrain: {
    universe: number; // reportes con >=1 línea de repuesto
    fullyTraceable: number;
    containsPlaceholder: number;
    containsNoMatch: number;
    containsAmbiguous: number;
    combinedProblems: number; // reportes con >1 categoría de problema simultánea
  };
  lineGrain: {
    totalLines: number;
    directMatches: number;
    historicalAliasMatches: number;
    descriptionMatches: number;
    ambiguous: number;
    placeholders: number;
    noMatch: number;
  };
  historicalAliasLimitation: string;
}

export interface Kpi5TemporalConsistency {
  evaluableReports: number;
  consistentReports: number;
  impossibleChronology: number;
  zeroDurationWarnings: number;
  nullDurationWarnings: number;
  percentage: number | null;
  apparentCreationLagMedian: number | null; // minutos, proxy exploratorio
  apparentCreationLagP90: number | null;
  apparentCreationLagDisclaimer: string;
}

export interface Kpi6InformationInconsistencies {
  affectedReports: number;
  evaluableReports: number;
  percentage: number | null;
  highSeverityReports: number;
  mediumSeverityReports: number;
  lowSeverityReports: number;
  warningOnlyReports: number;
  dominantCode: InconsistencyCode | null;
  oldestAffectedReportDate: string | null;
  totalSecondaryIssues: number;
  distributionByCode: Array<{ code: InconsistencyCode; severity: InconsistencySeverity; reportCount: number }>;
}

// §7 - selector de evolución. Las 4 series comparten un único punto por
// periodo (nunca se recarga al cambiar la serie seleccionada - el payload
// de /overview ya las trae todas). "inconsistencies" usa el mismo universo
// evaluable que KPI6 (todos los reportes con fecha, no solo cerrados);
// "completeness"/"equipmentIdentification" usan el universo cerrado (KPI1/KPI3);
// "traceability" usa el universo con repuestos (KPI4). Nunca actividad
// bruta - siempre un numerador/denominador de calidad.
export interface FieldbeatQualityEvolutionMetric {
  numerator: number;
  denominator: number;
  percentage: number | null;
}

export interface FieldbeatQualityEvolutionPoint {
  period: string; // "YYYY-MM"
  completeness: FieldbeatQualityEvolutionMetric;
  inconsistencies: FieldbeatQualityEvolutionMetric;
  traceability: FieldbeatQualityEvolutionMetric;
  equipmentIdentification: FieldbeatQualityEvolutionMetric;
}

// §8 - evolución estructurado-vs-texto para la pestaña Calidad. Liviana
// (solo equipment_identification_status), vive en /quality (y por herencia en
// /overview, que extiende FieldbeatQualityCoreKpis).
export interface FieldbeatequipmentIdentificationEvolutionPoint {
  period: string;
  structured: FieldbeatQualityEvolutionMetric;
  textConfident: FieldbeatQualityEvolutionMetric;
  textAmbiguous: FieldbeatQualityEvolutionMetric;
  missing: FieldbeatQualityEvolutionMetric;
}

export interface FieldbeatOverviewResponse {
  meta: FieldbeatQualityUniverseMetadata;
  kpi1: Kpi1StructuralCompleteness;
  kpi2: Kpi2TicketLinkage;
  kpi3: Kpi3equipmentIdentification;
  kpi4: Kpi4PartsTraceability;
  kpi5: Kpi5TemporalConsistency;
  evolution: FieldbeatQualityEvolutionPoint[];
  kpi6: Kpi6InformationInconsistencies;
}

export interface FieldbeatQualityResponse {
  meta: FieldbeatQualityUniverseMetadata;
  kpi1: Kpi1StructuralCompleteness;
  kpi2: Kpi2TicketLinkage;
  kpi3: Kpi3equipmentIdentification;
  kpi4: Kpi4PartsTraceability;
  kpi5: Kpi5TemporalConsistency;
  equipmentEvolution: FieldbeatequipmentIdentificationEvolutionPoint[];
  historicalAliasLimitation: string;
}
