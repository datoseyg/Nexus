import { NextRequest, NextResponse } from "next/server";
import { runQuery, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";

export const runtime = "nodejs";

const MAX_KEYWORDS = 6;
const RESULT_LIMIT_PER_SOURCE = 30;

const SELECT_COLUMNS = `
  m.fieldbeat_task_id,
  m.fieldbeat_task_date,
  m.client_name,
  m.equipment_internal_ids,
  m.task_type,
  m.task_state,
  m.technician_names,
  m.linked_zendesk_ticket_id,
  m.used_part_names,
  m.used_part_numbers,
  m.dolibarr_refs
`;

function tokenize(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .filter(token => token.length >= 2)
    .slice(0, MAX_KEYWORDS);
}

// "sin IA todavía" -> clasificación por keywords, sin LLM. Cada keyword
// debe matchear en AL MENOS una de las columnas de texto buscadas
// (client_name / task_type / description, o field_value en la segunda
// query) - AND entre keywords, OR entre columnas por keyword.
function buildDescriptionQuery(keywords: string[]) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  keywords.forEach((keyword, index) => {
    const paramIndex = index + 1;
    conditions.push(
      `(m.client_name ILIKE $${paramIndex} OR m.task_type ILIKE $${paramIndex} OR t.description ILIKE $${paramIndex})`
    );
    params.push(`%${keyword}%`);
  });

  const sql = `
    SELECT
      ${SELECT_COLUMNS},
      t.description,
      NULL AS field_name,
      NULL AS field_value,
      'description' AS match_source
    FROM marts.fieldbeat_report_dolibarr_operational_view m
    JOIN processed.fieldbeat_tasks t ON m.fieldbeat_task_id = t.fieldbeat_task_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY m.fieldbeat_task_date DESC
    LIMIT ${RESULT_LIMIT_PER_SOURCE}
  `;

  return { sql, params };
}

function buildReportFieldsQuery(keywords: string[]) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  keywords.forEach((keyword, index) => {
    const paramIndex = index + 1;
    conditions.push(`rf.field_value ILIKE $${paramIndex}`);
    params.push(`%${keyword}%`);
  });

  const sql = `
    SELECT
      ${SELECT_COLUMNS},
      NULL AS description,
      rf.field_name,
      rf.field_value,
      'report_field' AS match_source
    FROM processed.fieldbeat_report_fields rf
    JOIN marts.fieldbeat_report_dolibarr_operational_view m ON rf.fieldbeat_task_id = m.fieldbeat_task_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY m.fieldbeat_task_date DESC
    LIMIT ${RESULT_LIMIT_PER_SOURCE}
  `;

  return { sql, params };
}

// Reemplaza $1, $2... por el valor literal, SOLO para mostrar en el
// panel "ver query" de la UI - nunca se re-ejecuta este string, la
// query real corre con parámetros bindeados (runQuery(sql, params)).
function toReadableSql(sql: string, params: unknown[]): string {
  let readable = sql.trim().replace(/\s+/g, " ");

  params.forEach((value, index) => {
    const placeholder = `$${index + 1}`;
    readable = readable.split(placeholder).join(`'${String(value).replace(/'/g, "''")}'`);
  });

  return readable;
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (!q) {
    return NextResponse.json({ error: "Falta el parámetro de búsqueda (q)." }, { status: 400 });
  }

  const keywords = tokenize(q);

  if (keywords.length === 0) {
    return NextResponse.json({
      query: q,
      keywords: [],
      results: [],
      queries: [],
      message: "Escribí al menos una palabra de 2 o más caracteres."
    });
  }

  try {
    const descriptionQuery = buildDescriptionQuery(keywords);
    const descriptionResults = await runQuery(descriptionQuery.sql, descriptionQuery.params);

    // processed.fieldbeat_report_fields "si existe": esta segunda
    // búsqueda no debe tumbar toda la respuesta si esa tabla llegara a
    // faltar en el warehouse (ej. un db:build corrido antes del cierre
    // de Fase 1 que la agregó).
    let reportFieldsResults: Record<string, unknown>[] = [];
    let reportFieldsQuery: { sql: string; params: unknown[] } | null = null;

    try {
      reportFieldsQuery = buildReportFieldsQuery(keywords);
      reportFieldsResults = await runQuery(reportFieldsQuery.sql, reportFieldsQuery.params);
    } catch (error) {
      console.warn("Búsqueda en processed.fieldbeat_report_fields no disponible:", error);
    }

    const results = [...serializeRows(descriptionResults), ...serializeRows(reportFieldsResults)];

    const queries = [
      { label: "Búsqueda en descripción del task", sql: toReadableSql(descriptionQuery.sql, descriptionQuery.params) }
    ];

    if (reportFieldsQuery) {
      queries.push({
        label: "Búsqueda en campos de texto libre del reporte",
        sql: toReadableSql(reportFieldsQuery.sql, reportFieldsQuery.params)
      });
    }

    return NextResponse.json({
      query: q,
      keywords,
      results,
      resultCount: results.length,
      queries
    });
  } catch (error) {
    return handleApiError(error);
  }
}
