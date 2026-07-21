"use client";

import { StatusBadge } from "@/components/ui/StatusBadge";
import { BUTTON_TEXT_LINK } from "./search.styles";
import { formatDateEsCl, resolveTicketTitle, splitEquipmentIds, ticketStatusTone } from "./search.utils";
import type { SearchClientResult, SearchEntity, SearchMachineResult, SearchPartResult, SearchReportResult, SearchTicketResult } from "@/types/search";

type AnyResult = SearchClientResult | SearchMachineResult | SearchReportResult | SearchTicketResult | SearchPartResult;

interface SearchResultRowProps {
  entity: Exclude<SearchEntity, "all">;
  row: AnyResult;
  onOpenDetail: (entity: Exclude<SearchEntity, "all">, key: string) => void;
}

const ICONS: Record<Exclude<SearchEntity, "all">, string> = {
  reports: "📄",
  tickets: "🎫",
  clients: "🏥",
  machines: "🔧",
  parts: "⚙️"
};

function titleFor(entity: Exclude<SearchEntity, "all">, row: AnyResult): string {
  if (entity === "clients") return (row as SearchClientResult).clientName;
  if (entity === "machines") return (row as SearchMachineResult).machineId;
  if (entity === "reports") {
    const r = row as SearchReportResult;
    return r.snippet ? r.snippet : `Reporte #${r.fieldbeatTaskId}`;
  }
  if (entity === "tickets") {
    const t = row as SearchTicketResult;
    return resolveTicketTitle(t.title, t.ticketId);
  }
  const p = row as SearchPartResult;
  return p.partName || p.sku || p.rawIdentifier || "Repuesto sin identificar";
}

function metaFor(entity: Exclude<SearchEntity, "all">, row: AnyResult): React.ReactNode {
  if (entity === "clients") {
    const r = row as SearchClientResult;
    return (
      <>
        {r.reportCount.toLocaleString("es-CL")} reportes · {r.ticketCount.toLocaleString("es-CL")} tickets · {r.machineCount.toLocaleString("es-CL")} máquinas
      </>
    );
  }
  if (entity === "machines") {
    const r = row as SearchMachineResult;
    return (
      <>
        {r.clientName ?? "Sin cliente registrado"} · {r.reportCount.toLocaleString("es-CL")} reportes · {r.ticketCount.toLocaleString("es-CL")} tickets
      </>
    );
  }
  if (entity === "reports") {
    const r = row as SearchReportResult;
    const machines = splitEquipmentIds(r.machineId);
    return (
      <>
        {formatDateEsCl(r.date)} · {r.clientName ?? "—"} · {machines.length ? machines.join(", ") : "—"} · {r.taskType ?? "—"}
        {r.ticketId ? ` · Ticket #${r.ticketId}` : " · Sin ticket asociado"}
      </>
    );
  }
  if (entity === "tickets") {
    const r = row as SearchTicketResult;
    return (
      <>
        {r.clientName ?? "—"} · {r.linkedReportCount.toLocaleString("es-CL")} reportes vinculados · {formatDateEsCl(r.date)}
      </>
    );
  }
  const r = row as SearchPartResult;
  return (
    <>
      SKU: {r.sku ?? "—"} · {r.quantityConsumed.toLocaleString("es-CL")} consumidos · {r.reportCount.toLocaleString("es-CL")} reportes ·{" "}
      {r.clientCount.toLocaleString("es-CL")} clientes
    </>
  );
}

export function SearchResultRow({ entity, row, onOpenDetail }: SearchResultRowProps) {
  return (
    <li
      className="flex min-w-0 items-center justify-between gap-3 rounded-[var(--nx-radius-chip)] p-3"
      style={{ background: "#f7f8fb" }}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span aria-hidden="true" className="mt-0.5 text-base">
          {ICONS[entity]}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold" style={{ color: "var(--nx-text-primary)" }}>
            {titleFor(entity, row)}
          </p>
          <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--nx-text-secondary)" }}>
            {metaFor(entity, row)}
          </p>
          {entity === "tickets" && (
            <span className="mt-1 inline-block">
              <StatusBadge label={(row as SearchTicketResult).status ?? "Sin estado"} tone={ticketStatusTone((row as SearchTicketResult).status)} size="sm" />
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onOpenDetail(entity, row.key)}
        className={`shrink-0 whitespace-nowrap px-3 text-[13px] font-semibold underline ${BUTTON_TEXT_LINK}`}
        style={{ color: "var(--nx-accent-indigo)", minHeight: 44 }}
      >
        Ver detalle
      </button>
    </li>
  );
}
