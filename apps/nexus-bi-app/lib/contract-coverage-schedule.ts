// Bloque 2 (NEXUS V3) - único lugar que transforma filas crudas de
// config.contract_service_window_analysis en un ContractCoverageSchedule
// tipado. Recibe filas ya consultadas (sin acceso a datos propio) - tanto
// el drawer de Contratos (lib/explorer-sql.ts) como el detalle de
// Reportes/After-Hours (lib/fieldbeat-report-detail-queries.ts) hacen SQL
// "tonto" (mismo shape de fila) y llaman a esta única función - nunca se
// arma el JSON contractual en SQL de un lado y en JS del otro.
import type { ContractCoverageSchedule, ContractCoverageType, ContractDayOfWeek, ContractServiceWindow } from "@/types/contracts";

export interface RawServiceWindowRow {
  coverage_type: string;
  coverage_condition: string | null;
  parse_status: string;
  timezone: string;
  service_window_id: string | number | null;
  day_of_week: string | null;
  start_time: string | null;
  end_time: string | null;
  all_day: boolean | null;
  includes_holidays: boolean | null;
}

// Orden real Lun->Dom -nunca alfabético (alfabético daría FRI, MON, SAT,
// SUN, THU, TUE, WED). Único lugar donde se define este orden - ni el SQL
// ni el componente de UI reordenan por su cuenta.
const DAY_ORDER: Record<ContractDayOfWeek, number> = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 };

const DAY_LABELS: Record<ContractDayOfWeek, string> = {
  MON: "Lunes",
  TUE: "Martes",
  WED: "Miércoles",
  THU: "Jueves",
  FRI: "Viernes",
  SAT: "Sábado",
  SUN: "Domingo"
};

// config.contract_service_schedules.coverage_type ya es un CHECK cerrado
// exacto a este conjunto (sql/070_config.sql) - un valor no reconocido cae
// a "UNKNOWN" en vez de lanzar, señal de que este mapper quedó atrás de una
// migración nueva (mismo criterio que lib/contracts-vocabulary.ts).
const KNOWN_COVERAGE_TYPES: ReadonlySet<string> = new Set<ContractCoverageType>([
  "FULL_24X7",
  "CRITICAL_ONLY_24X7",
  "FIXED_WINDOW",
  "BUSINESS_HOURS_UNDEFINED",
  "ON_DEMAND",
  "NOT_COVERED",
  "NOT_APPLICABLE",
  "UNKNOWN"
]);

function toCoverageType(raw: string): ContractCoverageType {
  return (KNOWN_COVERAGE_TYPES.has(raw) ? raw : "UNKNOWN") as ContractCoverageType;
}

function isContractDayOfWeek(value: string | null): value is ContractDayOfWeek {
  return value !== null && value in DAY_ORDER;
}

/**
 * @param rows Filas de config.contract_service_window_analysis para UN
 *   contract_version_id (0 filas = MISSING, manejar antes de llamar acá; 1+
 *   filas = AVAILABLE, incluyendo el caso legítimo de una sola fila con
 *   service_window_id NULL = "schedule existe, cero ventanas").
 * @param versionValidity Vigencia de la VERSIÓN exacta que originó estas
 *   filas (contract_equipment_versions.valid_from/valid_to de ESE
 *   contract_version_id) - nunca "la vigente actual" del equipo. El caller
 *   la pasa porque ya la tiene resuelta de su propia consulta base; este
 *   mapper no hace un lookup adicional.
 */
export function mapServiceWindowRowsToCoverageSchedule(
  rows: RawServiceWindowRow[],
  versionValidity: { validFrom: string | null; validTo: string | null }
): ContractCoverageSchedule {
  const first = rows[0];
  const coverageType = toCoverageType(first.coverage_type);

  const windows: ContractServiceWindow[] = rows
    .filter(row => row.service_window_id !== null && isContractDayOfWeek(row.day_of_week))
    .map(row => ({
      dayOfWeek: row.day_of_week as ContractDayOfWeek,
      dayLabel: DAY_LABELS[row.day_of_week as ContractDayOfWeek],
      startTime: row.start_time,
      endTime: row.end_time,
      allDay: row.all_day ?? false,
      includesHolidays: row.includes_holidays ?? false
    }))
    .sort((a, b) => DAY_ORDER[a.dayOfWeek] - DAY_ORDER[b.dayOfWeek]);

  const coversWeekends = deriveCoversWeekends(coverageType, windows);
  const coversHolidays = deriveCoversHolidays(coverageType, windows);

  return {
    timezone: first.timezone,
    coverageType,
    parseStatus: first.parse_status === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" : "OK",
    windows,
    coversWeekends,
    coversHolidays,
    effectiveFrom: versionValidity.validFrom,
    effectiveTo: versionValidity.validTo,
    resolutionSource: "config.contract_service_schedules"
  };
}

// Nunca "false" por ausencia de datos -null cuando no hay ventanas de las
// que derivarlo (afirmar "no cubierto" sería inventar información que el
// contrato no da).
function deriveCoversWeekends(coverageType: ContractCoverageType, windows: ContractServiceWindow[]): boolean | null {
  if (coverageType === "FULL_24X7" || coverageType === "CRITICAL_ONLY_24X7") return true;
  if (coverageType === "FIXED_WINDOW") return windows.some(w => w.dayOfWeek === "SAT" || w.dayOfWeek === "SUN");
  return null;
}

function deriveCoversHolidays(coverageType: ContractCoverageType, windows: ContractServiceWindow[]): boolean | null {
  if (coverageType === "FULL_24X7" || coverageType === "CRITICAL_ONLY_24X7") return true;
  if (coverageType === "FIXED_WINDOW") return windows.some(w => w.includesHolidays);
  return null;
}
