import { NextRequest, NextResponse } from "next/server";
import type { DuckDBValue } from "@duckdb/node-api";
import { runQuery, serializeRows } from "@/lib/duckdb";
import {
  assertColumnExists,
  assertTableExists,
  clampPage,
  clampPageSize,
  getTableColumns,
  quoteIdentifier,
  quoteQualifiedTable
} from "@/lib/sql-guardrails";
import { handleApiError } from "@/lib/api-error";

interface RouteParams {
  params: Promise<{ schema: string; table: string }>;
}

// Explorador de tablas: solo lectura, paginado server-side (obligatorio —
// processed.fieldbeat_report_fields tiene 66107 filas). schema/table
// vienen de la URL, así que se validan contra information_schema antes
// de interpolarlos en cualquier SQL (no se pueden parametrizar
// identificadores). sortColumn/filterColumn pasan por el mismo chequeo.
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { schema, table } = await params;

  try {
    await assertTableExists(schema, table);
    const columns = await getTableColumns(schema, table);

    const searchParams = request.nextUrl.searchParams;
    const page = clampPage(Number(searchParams.get("page")));
    const pageSize = clampPageSize(Number(searchParams.get("pageSize")));
    const sortColumn = searchParams.get("sortColumn");
    const sortDir = searchParams.get("sortDir") === "desc" ? "DESC" : "ASC";
    const filterColumn = searchParams.get("filterColumn");
    const filterValue = searchParams.get("filterValue");

    const qualifiedTable = quoteQualifiedTable(schema, table);

    let whereClause = "";
    const whereParams: DuckDBValue[] = [];

    if (filterColumn && filterValue) {
      await assertColumnExists(schema, table, filterColumn);
      whereClause = `WHERE CAST(${quoteIdentifier(filterColumn)} AS VARCHAR) ILIKE $1`;
      whereParams.push(`%${filterValue}%`);
    }

    let orderClause = "";
    if (sortColumn) {
      await assertColumnExists(schema, table, sortColumn);
      orderClause = `ORDER BY ${quoteIdentifier(sortColumn)} ${sortDir}`;
    }

    const countRows = await runQuery<{ n: bigint }>(
      `SELECT COUNT(*) AS n FROM ${qualifiedTable} ${whereClause}`,
      whereParams
    );
    const totalRows = Number(countRows[0]?.n ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    // LIMIT/OFFSET interpolados directo (no vienen de texto libre del
    // usuario — ya pasaron por clampPage/clampPageSize, son enteros
    // acotados), consistente con cómo DuckDB no soporta parametrizar
    // LIMIT en todas las variantes de driver de forma confiable.
    const dataRows = await runQuery(
      `SELECT * FROM ${qualifiedTable} ${whereClause} ${orderClause} LIMIT ${pageSize} OFFSET ${offset}`,
      whereParams
    );

    return NextResponse.json({
      schema,
      table,
      columns,
      rows: serializeRows(dataRows),
      page: safePage,
      pageSize,
      totalRows,
      totalPages
    });
  } catch (error) {
    return handleApiError(error);
  }
}
