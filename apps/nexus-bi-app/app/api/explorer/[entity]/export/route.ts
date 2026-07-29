import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedUser, NexusAuthorizationError } from "@/lib/auth/authorization";
import { runQuery, serializeRows } from "@/lib/db";
import { handleApiError } from "@/lib/api-error";
import { escapeCsvCell } from "@/lib/csv-export";
import { createParamPusher } from "@/lib/search-filters";
import { MAX_EXPORT_ROWS } from "@/lib/fieldbeat-reports-queries";
import { EXPLORER_ENTITY_CONFIG, formatCell } from "@/lib/explorer-entity-config";
import { runGovernanceQuery } from "@/lib/governance-db";
import {
  buildClientsListQuery,
  buildContractsListQuery,
  buildEquipmentListQuery,
  buildPartsListQuery,
  buildProductsListQuery,
  buildReportsListQuery,
  buildTechniciansListQuery,
  buildTicketsListQuery,
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
  type IssuesExplorerFilters,
  type ReportsExplorerFilters
} from "@/lib/explorer-sql";
import type { ExplorerEntity } from "@/types/explorer";

export const runtime = "nodejs";

// Gate B - Familia 7: exportación CSV de cualquier entidad del Explorador
// semántico - mismo dispatcher de consultas que GET /api/explorer/[entity]
// (nunca SELECT *), pero sin paginar: universo completo hasta
// MAX_EXPORT_ROWS. Columnas = EXPLORER_ENTITY_CONFIG[entity].listColumns
// (el mismo allowlist ya usado en pantalla, B21 - nunca expone un campo
// "excluido siempre" porque esos nunca están en listColumns). Gerencia
// puede exportar sin permisos de escritura general (B76).
const SUPPORTED_ENTITIES: ExplorerEntity[] = ["reports", "tickets", "parts", "issues", "clients", "equipment", "technicians", "products", "contracts"];

export async function GET(request: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  let user;
  try {
    user = await requireAuthenticatedUser();
  } catch (error) {
    if (error instanceof NexusAuthorizationError) {
      const body = error.status === 401
        ? { error: "Unauthorized", code: "UNAUTHORIZED" }
        : { error: "Forbidden", code: "FORBIDDEN" };
      return NextResponse.json(body, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
    }
    return handleApiError(error);
  }

  try {
    const { entity: rawEntity } = await params;
    if (!SUPPORTED_ENTITIES.includes(rawEntity as ExplorerEntity)) {
      return NextResponse.json({ error: `Entidad de Explorador no soportada: "${rawEntity}"`, code: "NOT_FOUND" }, { status: 404 });
    }
    const entity = rawEntity as ExplorerEntity;
    const config = EXPLORER_ENTITY_CONFIG[entity];
    const searchParams = request.nextUrl.searchParams;
    const filter = searchParams.get("q")?.trim() || undefined;

    let rows: Record<string, unknown>[];
    let total: number;

    if (entity === "issues") {
      const issuesFilters: IssuesExplorerFilters = {
        severity: searchParams.get("severity") ?? undefined,
        status: searchParams.get("status") ?? undefined,
        entityType: searchParams.get("entityType") ?? undefined
      };
      const result = await fetchIssuesList(MAX_EXPORT_ROWS, 0, filter, issuesFilters);
      rows = result.rows;
      total = result.total;
    } else if (entity === "reports") {
      const reportsFilters: ReportsExplorerFilters = {
        client: searchParams.get("client") ?? undefined,
        taskType: searchParams.get("taskType") ?? undefined,
        dateFrom: searchParams.get("dateFrom") ?? undefined,
        dateTo: searchParams.get("dateTo") ?? undefined
      };
      const pusher = createParamPusher();
      const query = buildReportsListQuery(pusher, MAX_EXPORT_ROWS, 0, filter, reportsFilters);
      const [rawRows, count] = await Promise.all([
        runQuery<Record<string, unknown>>(query.sql, query.params),
        countReportsTotal(filter, reportsFilters)
      ]);
      rows = serializeRows(rawRows);
      total = count;
    } else {
      const pusher = createParamPusher();
      const { query, count } = await (async () => {
        switch (entity) {
          case "tickets":
            return { query: buildTicketsListQuery(pusher, MAX_EXPORT_ROWS, 0, filter), count: await countTicketsTotal(filter) };
          case "parts":
            return { query: buildPartsListQuery(pusher, MAX_EXPORT_ROWS, 0, filter), count: await countPartsTotal(filter) };
          case "clients":
            return { query: buildClientsListQuery(pusher, MAX_EXPORT_ROWS, 0, filter), count: await countClientsTotal(filter) };
          case "equipment":
            return { query: buildEquipmentListQuery(pusher, MAX_EXPORT_ROWS, 0, filter), count: await countEquipmentTotal(filter) };
          case "technicians":
            return { query: buildTechniciansListQuery(pusher, MAX_EXPORT_ROWS, 0, filter), count: await countTechniciansTotal(filter) };
          case "products":
            return { query: buildProductsListQuery(pusher, MAX_EXPORT_ROWS, 0, filter), count: await countProductsTotal(filter) };
          case "contracts":
            return { query: buildContractsListQuery(pusher, MAX_EXPORT_ROWS, 0, filter), count: await countContractsTotal(filter) };
          default:
            throw new Error(`Entidad sin consulta de exportación implementada: ${entity}`);
        }
      })();
      const rawRows = await runQuery<Record<string, unknown>>(query.sql, query.params);
      rows = serializeRows(rawRows);
      total = count;
    }

    rows = await enrichWithActiveIssueCounts(entity, rows);

    if (total > MAX_EXPORT_ROWS) {
      return NextResponse.json(
        {
          error: `La exportación supera el límite de ${MAX_EXPORT_ROWS.toLocaleString("es-CL")} filas (universo: ${total.toLocaleString("es-CL")}). Acota antes de exportar.`,
          code: "EXPORT_LIMIT_EXCEEDED",
          totalRows: total,
          maxExportRows: MAX_EXPORT_ROWS
        },
        { status: 413, headers: { "Cache-Control": "private, no-store" } }
      );
    }

    const lines = [
      config.listColumns.map(c => escapeCsvCell(c.header)).join(","),
      ...rows.map(row => config.listColumns.map(c => escapeCsvCell(formatCell(c, row))).join(","))
    ];

    await runGovernanceQuery(
      "app_read",
      "SELECT governance.fn_record_export_completed($1::uuid, $2, $3, $4::jsonb, $5::integer, $6)",
      [user.id, user.role, `explorer-${entity}`, JSON.stringify({}), rows.length, "csv"]
    );

    const today = new Date().toISOString().slice(0, 10);
    return new NextResponse(lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="nexus-explorador-${entity}-${today}.csv"`,
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}
