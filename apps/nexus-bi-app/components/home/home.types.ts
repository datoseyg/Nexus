// Contratos de Inicio: tipos + los type predicates que prueban en runtime
// que un valor `unknown` los cumple. Utilidades sin relación con un
// endpoint específico (formateo/normalización/guards genéricos) viven en
// home.utils.ts, no acá.
import { isNonNegativeSafeInteger } from "./home.utils";

// --- Unión genérica para el ciclo de vida de cada una de las 4 fuentes ---
export type RemoteData<T> =
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error" };

// --- Formas mínimas validadas por fuente (solo los campos que Inicio
//     consume de cada endpoint) ---
export interface AuditSummaryData {
  totalFieldbeatReports: number;
  reportsReviewRequired: number;
  partsMatched: number;
  partsUnmatched: number;
  partsAmbiguous: number;
  partsPlaceholder: number;
}

export interface OperacionalSummaryData {
  kpis: {
    totalTickets: number;
    totalRegistros: number;
    ultimoCliente: string | null;
  };
}

// Phase 3 reapertura §6 - el viejo GET /api/dashboard/fieldbeat (5
// agregados GOLD fijos) se eliminó (§11, sin consumidores DENTRO de
// FieldBeat) pero Inicio SÍ lo seguía llamando para este tile de estado -
// gap real encontrado en validación de navegador autenticado, no detectado
// por la búsqueda de consumidores previa (estaba fuera de components/fieldbeat/).
// Ahora apunta a GET /api/dashboard/fieldbeat/overview (contrato v2) - solo
// se valida el campo mínimo que Inicio realmente consume (kpi1.denominator,
// mismo criterio que lib/fieldbeat-tab-empty-predicates.ts::isOverviewEmpty
// usa para "hay universo cerrado evaluable").
export interface FieldbeatSummaryData {
  kpi1: { denominator: number };
}

export interface AfterHoursSummaryData {
  businessHoursStatus: string;
  holidaysStatus: string;
}

// --- Type predicates, sin `as`/`any`/`@ts-ignore` (mismo patrón que
//     hasMoreFiltersGuard en components/ui/FilterBar.tsx: narrowing real
//     vía función, no un cast puntual). Los campos numéricos usan
//     isNonNegativeSafeInteger (home.utils.ts). ---
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isAuditSummaryData(value: unknown): value is AuditSummaryData {
  return (
    isRecord(value) &&
    isNonNegativeSafeInteger(value.totalFieldbeatReports) &&
    isNonNegativeSafeInteger(value.reportsReviewRequired) &&
    isNonNegativeSafeInteger(value.partsMatched) &&
    isNonNegativeSafeInteger(value.partsUnmatched) &&
    isNonNegativeSafeInteger(value.partsAmbiguous) &&
    isNonNegativeSafeInteger(value.partsPlaceholder)
  );
}

export function isOperacionalSummaryData(value: unknown): value is OperacionalSummaryData {
  if (!isRecord(value) || !isRecord(value.kpis)) return false;
  const kpis = value.kpis;
  return (
    isNonNegativeSafeInteger(kpis.totalTickets) &&
    isNonNegativeSafeInteger(kpis.totalRegistros) &&
    (typeof kpis.ultimoCliente === "string" || kpis.ultimoCliente === null)
  );
}

export function isFieldbeatSummaryData(value: unknown): value is FieldbeatSummaryData {
  if (!isRecord(value) || !isRecord(value.kpi1)) return false;
  return isNonNegativeSafeInteger(value.kpi1.denominator);
}

export function isAfterHoursSummaryData(value: unknown): value is AfterHoursSummaryData {
  return (
    isRecord(value) &&
    typeof value.businessHoursStatus === "string" &&
    typeof value.holidaysStatus === "string"
  );
}

// --- Estado de área (panel "Estado de la información"). Incluye
//     "loading" además de los 5 estados de contenido definidos en el plan
//     - completa el caso "la fuente todavía no resolvió", que las reglas
//     de derivación del plan/encargo (failed/empty|stale|needs-review/
//     success) no necesitaban nombrar porque describen solo el resultado
//     ya asentado. Sin este valor, HomeDataStatus no podría representar
//     con honestidad una fuente que aún no respondió (mostrar cualquiera
//     de los otros 5 sería afirmar algo que todavía no se sabe). ---
export type HomeAreaStatus = "loading" | "success" | "needs-review" | "stale" | "empty" | "failed";

// --- Estado de una fuente proyectado a un KPI: unión discriminada real,
//     no status+value independientes. `value` solo existe cuando
//     status==="success"; en los otros dos casos es `?:never`, así que
//     TypeScript rechaza en tiempo de compilación cualquier intento de
//     leerlo fuera de esa rama (mismo mecanismo que el discriminated
//     union con never ya usado en FilterBar.tsx). ---
export type HomeMetricState =
  | { status: "loading"; value?: never }
  | { status: "success"; value: number }
  | { status: "error"; value?: never };

export type HomeKpiKey = "reportesTotales" | "tickets" | "repuestosUtilizados" | "requierenRevision";
export type HomeKpiAccent = "green" | "indigo" | "purple" | "amber";

// --- Tipo genérico parametrizado por clave: cada posición de la tupla
//     (HomeKpiTuple, más abajo) fija su propia K literal - la tupla no
//     solo tiene longitud 4, cada posición exige la clave correcta en el
//     orden correcto, verificado por el compilador sin ningún cast. ---
export type HomeKpiOf<K extends HomeKpiKey> = HomeMetricState & {
  key: K;
  label: string;
  accent: HomeKpiAccent;
};

export type HomeKpi = HomeKpiOf<HomeKpiKey>;

export type HomeKpiTuple = readonly [
  HomeKpiOf<"reportesTotales">,
  HomeKpiOf<"tickets">,
  HomeKpiOf<"repuestosUtilizados">,
  HomeKpiOf<"requierenRevision">
];

// --- Mismo patrón para el panel de estado por área ---
export type HomeAreaKey = "operacional" | "fieldbeat" | "afterHours" | "auditoria";

export type HomeAreaStatusOf<A extends HomeAreaKey> = {
  area: A;
  label: string;
  status: HomeAreaStatus;
};

export type HomeAreaStatusEntry = HomeAreaStatusOf<HomeAreaKey>;

export type HomeAreaStatusTuple = readonly [
  HomeAreaStatusOf<"operacional">,
  HomeAreaStatusOf<"fieldbeat">,
  HomeAreaStatusOf<"afterHours">,
  HomeAreaStatusOf<"auditoria">
];

// --- "Último cliente registrado": misma disciplina de unión discriminada
//     que HomeMetricState - `clientName` no existe fuera de "success". ---
export type HomeLastClientState =
  | { status: "loading"; clientName?: never }
  | { status: "success"; clientName: string | null }
  | { status: "error"; clientName?: never };

export interface HomeAttentionItem {
  id: string;
  message: string;
  tone: "warning";
}
