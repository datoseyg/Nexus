// Cruces orientados a problemas (Phase 3 §9). Cada cruce es UNA query
// parametrizada (nunca SQL dinámico libre: `type` ya llegó validado contra
// el allowlist de types/fieldbeat-crossings.ts antes de entrar acá, ver
// route.ts) que devuelve pares (row, col, count) en formato largo - el
// pivote a matriz (rows[]/cols[]/cells[]) y el límite de filas ("Otros")
// se hacen en TypeScript, no en SQL, para mantener cada query simple y
// testeable por separado.
//
// Nunca se reintroduce el cruce operacional cliente x equipo (eliminado
// del flujo activo de FieldBeat, ver §11 - ese cruce sigue existiendo en
// Operacional, sin tocar).
import { runQuery } from "./db";
import { createParamPusher } from "./dashboard-filters";
import { buildFieldbeatQualityConditions, type FieldbeatQualityFilters } from "./fieldbeat-quality-filters";
import type { CrossingType } from "@/types/fieldbeat-crossings";

const MAX_ROWS = 15;
const OTHER_ROW_LABEL = "Otros";
const NULL_LABEL: Record<CrossingType, string> = {
  task_type_missing_field: "(sin tipo)",
  technician_completeness: "(sin técnico)",
  client_inconsistency_type: "(sin cliente)",
  technician_inconsistency_type: "(sin técnico)",
  equipment_problem: "(sin equipo)",
  origin_quality: "(sin origen)"
};

export interface CrossingPair {
  rowKey: string;
  colKey: string;
  count: number;
}

function buildWhere(filters: FieldbeatQualityFilters, alias: string): { whereSql: string; params: unknown[] } {
  const pusher = createParamPusher();
  const conditions = buildFieldbeatQualityConditions(filters, alias, pusher);
  return { whereSql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", params: pusher.params };
}

// Techo de seguridad sobre los PARES crudos devueltos por Postgres, antes
// de pivotear/truncar en TS - nunca alcanzado en operación real (la
// cardinalidad máxima medida hoy es equipo x problema, 58 x 10 = 580
// pares, ver reconciliación Phase 3 reapertura §5) pero protege contra un
// payload sin límite si algún eje creciera de forma patológica. Si alguna
// vez se alcanza, `pivotCrossing()` sigue produciendo una matriz acotada
// igual - totalRows/totalCols podrían subestimarse en ese escenario
// extremo, degradación aceptada y documentada, nunca un payload sin techo.
const MAX_RAW_PAIRS = 20000;

async function runPairQuery(sql: string, params: unknown[]): Promise<CrossingPair[]> {
  const wrapped = `
    WITH pairs AS (${sql})
    SELECT row_key, col_key, n FROM pairs
    ORDER BY n DESC, row_key ASC, col_key ASC
    LIMIT ${MAX_RAW_PAIRS}
  `;
  const rows = await runQuery<{ row_key: string; col_key: string; n: string }>(wrapped, params);
  return rows.map(r => ({ rowKey: r.row_key, colKey: r.col_key, count: Number(r.n) }));
}

// 1. Tipo de tarea x campo faltante - universo: reportes cerrados. Un
// reporte puede aportar 0..3 pares (una fila por campo faltante).
async function queryTaskTypeMissingField(filters: FieldbeatQualityFilters): Promise<CrossingPair[]> {
  const { whereSql, params } = buildWhere(filters, "q");
  return runPairQuery(
    `
    WITH universe AS (SELECT * FROM quality.fieldbeat_report_quality q ${whereSql})
    SELECT COALESCE(u.task_type, '${NULL_LABEL.task_type_missing_field}') AS row_key, mf.missing_field AS col_key, COUNT(*) AS n
    FROM universe u,
    LATERAL (
      SELECT unnest(ARRAY[
        CASE WHEN NOT u.has_technician THEN 'Técnico' END,
        CASE WHEN NOT u.has_client THEN 'Cliente' END,
        CASE WHEN u.equipment_identification_status NOT IN ('STRUCTURED_IDENTIFIED', 'TEXT_CONFIDENT_IDENTIFIED') THEN 'Equipo' END
      ]) AS missing_field
    ) mf
    WHERE u.is_closed AND mf.missing_field IS NOT NULL
    GROUP BY 1, 2
    `,
    params
  );
}

// 2. Técnico x completitud - universo: reportes cerrados.
async function queryTechnicianCompleteness(filters: FieldbeatQualityFilters): Promise<CrossingPair[]> {
  const { whereSql, params } = buildWhere(filters, "q");
  return runPairQuery(
    `
    SELECT
      COALESCE(technician_names, '${NULL_LABEL.technician_completeness}') AS row_key,
      CASE WHEN structurally_complete THEN 'Completo' ELSE 'Incompleto' END AS col_key,
      COUNT(*) AS n
    FROM quality.fieldbeat_report_quality q
    ${whereSql ? `${whereSql} AND is_closed` : "WHERE is_closed"}
    GROUP BY 1, 2
    `,
    params
  );
}

// 3/4. Cliente|Técnico x tipo de inconsistencia - universo: reportes con
// al menos una inconsistencia (todos los códigos, no solo el primario).
async function queryDimensionInconsistencyType(filters: FieldbeatQualityFilters, dimensionColumn: "client_name" | "technician_names", nullLabel: string): Promise<CrossingPair[]> {
  const { whereSql, params } = buildWhere(filters, "q");
  return runPairQuery(
    `
    WITH universe AS (SELECT * FROM quality.fieldbeat_report_quality q ${whereSql})
    SELECT COALESCE(u.${dimensionColumn}, '${nullLabel}') AS row_key, ri.code AS col_key, COUNT(*) AS n
    FROM quality.fieldbeat_report_inconsistencies ri
    JOIN universe u ON u.fieldbeat_task_id = ri.fieldbeat_task_id
    GROUP BY 1, 2
    `,
    params
  );
}

// 5. Equipo x problema - universo: reportes con equipo estructurado
// identificado y al menos una inconsistencia. Reportes sin equipo
// identificado quedan fuera de este cruce específico (no tienen una fila
// de equipo real que mostrar) - decisión documentada, no un bug.
async function queryEquipmentProblem(filters: FieldbeatQualityFilters): Promise<CrossingPair[]> {
  const { whereSql, params } = buildWhere(filters, "q");
  return runPairQuery(
    `
    WITH universe AS (SELECT * FROM quality.fieldbeat_report_quality q ${whereSql})
    SELECT eq.equipment_id AS row_key, ri.code AS col_key, COUNT(*) AS n
    FROM quality.fieldbeat_report_inconsistencies ri
    JOIN universe u ON u.fieldbeat_task_id = ri.fieldbeat_task_id,
    LATERAL unnest(string_to_array(NULLIF(u.equipment_internal_ids, ''), '|')) AS eq(equipment_id)
    WHERE eq.equipment_id IS NOT NULL
    GROUP BY 1, 2
    `,
    params
  );
}

// 6. Origen x calidad - universo: todo el universo filtrado (sin
// restringir a cerrados - "calidad" acá es report_quality_status, no
// completitud estructural).
async function queryOriginQuality(filters: FieldbeatQualityFilters): Promise<CrossingPair[]> {
  const { whereSql, params } = buildWhere(filters, "q");
  return runPairQuery(
    `
    SELECT
      COALESCE(origen, '${NULL_LABEL.origin_quality}') AS row_key,
      COALESCE(report_quality_status, '(sin estado)') AS col_key,
      COUNT(*) AS n
    FROM quality.fieldbeat_report_quality q
    ${whereSql}
    GROUP BY 1, 2
    `,
    params
  );
}

export async function queryCrossing(type: CrossingType, filters: FieldbeatQualityFilters): Promise<CrossingPair[]> {
  switch (type) {
    case "task_type_missing_field":
      return queryTaskTypeMissingField(filters);
    case "technician_completeness":
      return queryTechnicianCompleteness(filters);
    case "client_inconsistency_type":
      return queryDimensionInconsistencyType(filters, "client_name", NULL_LABEL.client_inconsistency_type);
    case "technician_inconsistency_type":
      return queryDimensionInconsistencyType(filters, "technician_names", NULL_LABEL.technician_inconsistency_type);
    case "equipment_problem":
      return queryEquipmentProblem(filters);
    case "origin_quality":
      return queryOriginQuality(filters);
  }
}

// Phase 3 reapertura §5 - ANTES solo las filas tenían límite explícito
// ("columnas: sin límite" - señalado como riesgo real, aunque hoy ninguna
// columna real supera 10 valores: son vocabularios acotados por diseño -
// campo faltante fijo en 3, código de inconsistencia fijo en 10 por la
// taxonomía, estado de calidad fijo en 6). Ahora ambos ejes tienen un tope
// determinista y explícito, defensa en profundidad ante un vocabulario que
// crezca sin que nadie actualice este archivo.
const MAX_COLS = 12;
const OTHER_COL_LABEL = "Otras";

export interface PivotedCrossing {
  rows: string[];
  cols: string[];
  cells: Array<{ row: string; col: string; count: number }>;
  rowTotals: Record<string, number>;
  colTotals: Record<string, number>;
  grandTotal: number;
  totalRows: number;
  totalCols: number;
  shownRows: number;
  shownCols: number;
  aggregated: boolean;
}

/**
 * Pivota pares (row, col, count) a matriz, con las filas y columnas de
 * menor volumen agrupadas bajo "Otros"/"Otras" cuando exceden
 * MAX_ROWS/MAX_COLS. Orden determinista: por total descendente, empate por
 * nombre ASC en ambos ejes.
 */
export function pivotCrossing(pairs: readonly CrossingPair[]): PivotedCrossing {
  const rowTotals = new Map<string, number>();
  const colTotalsMap = new Map<string, number>();
  for (const p of pairs) {
    rowTotals.set(p.rowKey, (rowTotals.get(p.rowKey) ?? 0) + p.count);
    colTotalsMap.set(p.colKey, (colTotalsMap.get(p.colKey) ?? 0) + p.count);
  }

  const totalRows = rowTotals.size;
  const totalCols = colTotalsMap.size;

  const sortedRowKeys = [...rowTotals.keys()].sort((a, b) => rowTotals.get(b)! - rowTotals.get(a)! || a.localeCompare(b));
  const rowsTruncated = sortedRowKeys.length > MAX_ROWS;
  const keptRows = rowsTruncated ? sortedRowKeys.slice(0, MAX_ROWS) : sortedRowKeys;
  const keptRowSet = new Set(keptRows);

  const sortedColKeys = [...colTotalsMap.keys()].sort((a, b) => colTotalsMap.get(b)! - colTotalsMap.get(a)! || a.localeCompare(b));
  const colsTruncated = sortedColKeys.length > MAX_COLS;
  const keptCols = colsTruncated ? sortedColKeys.slice(0, MAX_COLS) : sortedColKeys;
  const keptColSet = new Set(keptCols);

  const cellMap = new Map<string, { row: string; col: string; count: number }>();
  const finalRowTotals = new Map<string, number>();
  for (const row of keptRows) finalRowTotals.set(row, 0);
  if (rowsTruncated) finalRowTotals.set(OTHER_ROW_LABEL, 0);
  const finalColTotals = new Map<string, number>();
  for (const col of keptCols) finalColTotals.set(col, 0);
  if (colsTruncated) finalColTotals.set(OTHER_COL_LABEL, 0);

  for (const p of pairs) {
    const rowLabel = keptRowSet.has(p.rowKey) ? p.rowKey : OTHER_ROW_LABEL;
    const colLabel = keptColSet.has(p.colKey) ? p.colKey : OTHER_COL_LABEL;
    const key = JSON.stringify([rowLabel, colLabel]);
    const existing = cellMap.get(key);
    if (existing) existing.count += p.count;
    else cellMap.set(key, { row: rowLabel, col: colLabel, count: p.count });
    finalRowTotals.set(rowLabel, (finalRowTotals.get(rowLabel) ?? 0) + p.count);
    finalColTotals.set(colLabel, (finalColTotals.get(colLabel) ?? 0) + p.count);
  }

  const rows = rowsTruncated ? [...keptRows, OTHER_ROW_LABEL] : keptRows;
  const cols = colsTruncated ? [...keptCols, OTHER_COL_LABEL] : keptCols;
  const cells = [...cellMap.values()];

  const colTotals: Record<string, number> = {};
  for (const col of cols) colTotals[col] = finalColTotals.get(col) ?? 0;

  const rowTotalsObj: Record<string, number> = {};
  for (const row of rows) rowTotalsObj[row] = finalRowTotals.get(row) ?? 0;

  const grandTotal = pairs.reduce((acc, p) => acc + p.count, 0);

  return {
    rows,
    cols,
    cells,
    rowTotals: rowTotalsObj,
    colTotals,
    grandTotal,
    totalRows,
    totalCols,
    shownRows: rows.length,
    shownCols: cols.length,
    aggregated: rowsTruncated || colsTruncated
  };
}
