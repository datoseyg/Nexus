import { NextRequest, NextResponse } from "next/server";
import { requireReadApiAccess } from "@/lib/auth/authorization";
import { runQuery, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { createParamPusher } from "@/lib/search-filters";
import {
  buildClientsListQuery,
  buildContractsListQuery,
  buildEquipmentListQuery,
  buildPartsListQuery,
  buildProductsListQuery,
  buildReportsListQuery,
  buildTechniciansListQuery,
  buildTicketsListQuery,
  clampExplorerPage,
  clampExplorerPageSize,
  countClientsTotal,
  countContractsTotal,
  countEquipmentTotal,
  countPartsTotal,
  countProductsTotal,
  countReportsTotal,
  countTechniciansTotal,
  countTicketsTotal,
  enrichWithActiveIssueCounts,
  fetchIssuesList,
  fetchReportTaskTypes,
  type IssuesExplorerFilters,
  type ReportsExplorerFilters
} from "@/lib/explorer-sql";
import type { ExplorerEntity, ExplorerListResponse } from "@/types/explorer";

export const runtime = "nodejs";

// Explorador semántico (Gate B, B20) - un endpoint por entidad de negocio,
// nunca schema.tabla física (eso es exactamente lo que /api/tables hacía y
// que este Explorador reemplaza, B23). Cada rama tiene su propia consulta
// curada (lib/explorer-sql.ts) - nunca SELECT * ni columnas resueltas por
// information_schema.
const SUPPORTED_ENTITIES: ExplorerEntity[] = [
  "reports",
  "tickets",
  "parts",
  "issues",
  "clients",
  "equipment",
  "technicians",
  "products",
  "contracts"
];

export async function GET(request: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  const authError = await requireReadApiAccess();
  if (authError) return authError;

  try {
    const { entity } = await params;
    if (!SUPPORTED_ENTITIES.includes(entity as ExplorerEntity)) {
      return NextResponse.json(
        { error: `Entidad de Explorador no soportada: "${entity}"`, code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const page = clampExplorerPage(Number(searchParams.get("page")));
    const pageSize = clampExplorerPageSize(Number(searchParams.get("pageSize")) || 25);
    const offset = (page - 1) * pageSize;
    const filter = searchParams.get("q")?.trim() || undefined;

    if (entity === "issues") {
      const issuesFilters: IssuesExplorerFilters = {
        severity: searchParams.get("severity") ?? undefined,
        status: searchParams.get("status") ?? undefined,
        entityType: searchParams.get("entityType") ?? undefined
      };
      const { rows, total } = await fetchIssuesList(pageSize, offset, filter, issuesFilters);
      return NextResponse.json(buildResponse("issues", rows, page, pageSize, total));
    }

    if (entity === "reports") {
      const reportsFilters: ReportsExplorerFilters = {
        client: searchParams.get("client") ?? undefined,
        taskType: searchParams.get("taskType") ?? undefined,
        dateFrom: searchParams.get("dateFrom") ?? undefined,
        dateTo: searchParams.get("dateTo") ?? undefined
      };
      const pusher = createParamPusher();
      const query = buildReportsListQuery(pusher, pageSize, offset, filter, reportsFilters);
      const [rows, total, taskTypes] = await Promise.all([
        runQuery<Record<string, unknown>>(query.sql, query.params),
        countReportsTotal(filter, reportsFilters),
        fetchReportTaskTypes()
      ]);
      const enriched = await enrichWithActiveIssueCounts("reports", serializeRows(rows));
      return NextResponse.json({ ...buildResponse("reports", enriched, page, pageSize, total), facets: { taskTypes } });
    }

    const pusher = createParamPusher();
    const { query, countPromise } = (() => {
      switch (entity as ExplorerEntity) {
        case "tickets":
          return { query: buildTicketsListQuery(pusher, pageSize, offset, filter), countPromise: countTicketsTotal(filter) };
        case "parts":
          return { query: buildPartsListQuery(pusher, pageSize, offset, filter), countPromise: countPartsTotal(filter) };
        case "clients":
          return { query: buildClientsListQuery(pusher, pageSize, offset, filter), countPromise: countClientsTotal(filter) };
        case "equipment":
          return { query: buildEquipmentListQuery(pusher, pageSize, offset, filter), countPromise: countEquipmentTotal(filter) };
        case "technicians":
          return { query: buildTechniciansListQuery(pusher, pageSize, offset, filter), countPromise: countTechniciansTotal(filter) };
        case "products":
          return { query: buildProductsListQuery(pusher, pageSize, offset, filter), countPromise: countProductsTotal(filter) };
        case "contracts":
          return { query: buildContractsListQuery(pusher, pageSize, offset, filter), countPromise: countContractsTotal(filter) };
        default:
          throw new Error(`Entidad sin consulta implementada: ${entity}`);
      }
    })();

    const [rows, total] = await Promise.all([runQuery<Record<string, unknown>>(query.sql, query.params), countPromise]);
    const enriched = await enrichWithActiveIssueCounts(entity as ExplorerEntity, serializeRows(rows));
    return NextResponse.json(buildResponse(entity as ExplorerEntity, enriched, page, pageSize, total));
  } catch (error) {
    return handleApiError(error);
  }
}

function buildResponse(
  entity: ExplorerEntity,
  rows: Record<string, unknown>[],
  page: number,
  pageSize: number,
  totalRows: number
): ExplorerListResponse {
  return {
    entity,
    rows,
    page,
    pageSize,
    totalRows,
    totalPages: Math.max(1, Math.ceil(totalRows / pageSize))
  };
}
