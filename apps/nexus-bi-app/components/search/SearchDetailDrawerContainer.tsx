"use client";

import { useEffect, useRef, useState } from "react";
import { DetailDrawer } from "@/components/ui/DetailDrawer";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { BUTTON_SECONDARY } from "./search.styles";
import { isSearchDetailResponse, type DetailState } from "./search.types";
import { formatDateEsCl, resolveTicketTitle, ticketStatusTone } from "./search.utils";
import type { SearchEntity } from "@/types/search";

interface SearchDetailDrawerContainerProps {
  request: { entity: Exclude<SearchEntity, "all">; key: string } | null;
  onClose: () => void;
  /** HOTFIX de integridad de datos FieldBeat (Stage 9, UX canónica) - abre
   * el drawer CANÓNICO de reporte (FieldbeatReportDetailDrawer), nunca el
   * propio de Search. El caller (SearchDashboard) es quien cierra ESTE
   * drawer antes/al mismo tiempo de abrir el canónico - nunca dos diálogos
   * apilados. */
  onOpenReport: (fieldbeatTaskId: string) => void;
}

const GLOBAL_NOTE = "Esta vista muestra el estado global de la entidad, sin aplicar los filtros de búsqueda actuales.";

// Causa raíz del contraste: ni DetailDrawer.tsx (components/ui, --nx-card-bg
// fijo) ni este contenido aplicaban una propiedad `color` explícita a nivel
// de contenedor - varios nodos (dd, li, título de ticket) no fijaban color
// propio y heredaban el `color` YA COMPUTADO en un ancestro superior (body,
// vía --text-primary con variante oscura bajo prefers-color-scheme:dark).
// Redefinir --text-primary/--text-secondary/--text-muted más abajo en el
// árbol NO alcanza a esos nodos: ese valor de `color` heredado ya quedó
// resuelto en el ancestro, antes de llegar acá. Por eso el wrapper de abajo
// FIJA `color` de verdad (no solo redefine la custom property) - así todo
// hijo sin color propio hereda un tono oscuro real, y además se redefinen
// los tokens heredados por si algún componente compartido los consumiera.
const DETAIL_SURFACE_STYLE = {
  color: "var(--nx-text-primary)",
  "--text-primary": "#181c2c",
  "--text-secondary": "#5a5f73",
  "--text-muted": "#9aa0c0",
  "--border": "#e2e5ee",
  "--surface-1": "#ffffff",
  "--surface-2": "#f7f8fb"
} as React.CSSProperties;

const SECTION_TITLE_STYLE: React.CSSProperties = { color: "var(--nx-text-secondary)" };
const LABEL_STYLE: React.CSSProperties = { color: "var(--nx-text-secondary)" };
const VALUE_CLASS = "font-semibold";
const EMPTY_STYLE: React.CSSProperties = { color: "var(--nx-text-muted)" };

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide" style={SECTION_TITLE_STYLE}>
      {children}
    </h3>
  );
}

/** Fila de lista de 2 líneas (primaria oscura/semibold + secundaria legible) -
 * reemplaza el patrón de una sola línea en gris parejo. HOTFIX de integridad
 * de datos FieldBeat (Stage 9): con `onClick` se renderiza como <button>
 * real (foco/teclado/Enter-Space nativos) en vez de un <li> inerte - las
 * filas de "reportes relacionados" (recentReports/linkedReports/recentUsages)
 * dejan de ser 100% inertes, abren el drawer canónico del reporte. */
function DetailListItem({ primary, secondary, onClick }: { primary: React.ReactNode; secondary?: React.ReactNode; onClick?: () => void }) {
  const content = (
    <>
      <p className="text-[13.5px] font-semibold" style={{ color: "var(--nx-text-primary)" }}>
        {primary}
      </p>
      {secondary && (
        <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--nx-text-secondary)" }}>
          {secondary}
        </p>
      )}
    </>
  );
  if (!onClick) {
    return (
      <li className="-mx-2 rounded-[var(--nx-radius-chip)] border-b px-2 py-2 last:border-b-0" style={{ borderColor: "var(--nx-border)" }}>
        {content}
      </li>
    );
  }
  return (
    <li className="border-b last:border-b-0" style={{ borderColor: "var(--nx-border)" }}>
      <button
        type="button"
        onClick={onClick}
        className="-mx-2 block w-full rounded-[var(--nx-radius-chip)] px-2 py-2 text-left hover:bg-[var(--nx-page-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nx-focus-ring-color)]"
        style={{ minHeight: 44 }}
      >
        {content}
      </button>
    </li>
  );
}

function EmptyListItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="text-[13px]" style={EMPTY_STYLE}>
      {children}
    </li>
  );
}

function DetailBody({ state, onRetry, onOpenReport }: { state: DetailState; onRetry: () => void; onOpenReport: (fieldbeatTaskId: string) => void }) {
  if (state.status === "loading") {
    return (
      <p aria-busy="true" style={{ color: "var(--nx-text-secondary)" }}>
        Cargando detalle…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-2.5">
        <div role="alert" style={{ color: "var(--nx-danger-fg)" }}>
          {state.message}
        </div>
        <button
          type="button"
          onClick={onRetry}
          className={`self-start whitespace-nowrap rounded-[var(--nx-radius-button)] border px-4 text-[13px] font-semibold ${BUTTON_SECONDARY}`}
          style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", minHeight: 44 }}
        >
          Reintentar
        </button>
      </div>
    );
  }
  if (state.status !== "success") return null;

  const data = state.data;

  if (data.entity === "clients") {
    return (
      <div className="flex flex-col gap-4 text-sm">
        <dl className="grid grid-cols-2 gap-2">
          <dt style={LABEL_STYLE}>Reportes</dt>
          <dd className={VALUE_CLASS}>{data.summary.reportCount.toLocaleString("es-CL")}</dd>
          <dt style={LABEL_STYLE}>Tickets</dt>
          <dd className={VALUE_CLASS}>{data.summary.ticketCount.toLocaleString("es-CL")}</dd>
          <dt style={LABEL_STYLE}>Máquinas</dt>
          <dd className={VALUE_CLASS}>{data.summary.machineCount.toLocaleString("es-CL")}</dd>
        </dl>
        <section>
          <SectionTitle>Reportes recientes</SectionTitle>
          <ul className="flex flex-col">
            {data.recentReports.map(r => (
              <DetailListItem key={r.key} primary={`#${r.fieldbeatTaskId} · ${formatDateEsCl(r.date)}`} secondary={r.taskType ?? "—"} onClick={() => onOpenReport(r.fieldbeatTaskId)} />
            ))}
            {data.recentReports.length === 0 && <EmptyListItem>Sin reportes.</EmptyListItem>}
          </ul>
        </section>
        <section>
          <SectionTitle>Máquinas</SectionTitle>
          <ul className="flex flex-col">
            {data.machines.map(m => (
              <DetailListItem key={m.key} primary={m.machineId} secondary={`${m.reportCount.toLocaleString("es-CL")} reportes`} />
            ))}
            {data.machines.length === 0 && <EmptyListItem>Sin máquinas.</EmptyListItem>}
          </ul>
        </section>
        <section>
          <SectionTitle>Tickets</SectionTitle>
          <ul className="flex flex-col">
            {data.tickets.map(t => (
              <li key={t.key} className="flex items-start gap-2 border-b py-2 last:border-b-0" style={{ borderColor: "var(--nx-border)" }}>
                <StatusBadge label={t.status ?? "Sin estado"} tone={ticketStatusTone(t.status)} size="sm" />
                <span className="text-[13.5px] leading-5" style={{ color: "var(--nx-text-primary)" }}>
                  {resolveTicketTitle(t.title, t.ticketId)}
                </span>
              </li>
            ))}
            {data.tickets.length === 0 && <EmptyListItem>Sin tickets vinculados.</EmptyListItem>}
          </ul>
        </section>
      </div>
    );
  }

  if (data.entity === "machines") {
    return (
      <div className="flex flex-col gap-4 text-sm">
        <dl className="grid grid-cols-2 gap-2">
          <dt style={LABEL_STYLE}>Cliente</dt>
          <dd className={VALUE_CLASS}>{data.summary.clientName ?? "—"}</dd>
          <dt style={LABEL_STYLE}>Reportes</dt>
          <dd className={VALUE_CLASS}>{data.summary.reportCount.toLocaleString("es-CL")}</dd>
          <dt style={LABEL_STYLE}>Tickets</dt>
          <dd className={VALUE_CLASS}>{data.summary.ticketCount.toLocaleString("es-CL")}</dd>
        </dl>
        <section>
          <SectionTitle>Reportes recientes</SectionTitle>
          <ul className="flex flex-col">
            {data.recentReports.map(r => (
              <DetailListItem key={r.key} primary={`#${r.fieldbeatTaskId} · ${formatDateEsCl(r.date)}`} secondary={r.clientName ?? "—"} onClick={() => onOpenReport(r.fieldbeatTaskId)} />
            ))}
            {data.recentReports.length === 0 && <EmptyListItem>Sin reportes.</EmptyListItem>}
          </ul>
        </section>
      </div>
    );
  }

  // HOTFIX de integridad de datos FieldBeat (Stage 9, UX canónica) - Search
  // YA NUNCA abre su propio drawer para la entidad "reports" (SearchDashboard
  // intercepta el click y abre directamente FieldbeatReportDetailDrawer, el
  // canónico) - esta rama quedaría inalcanzable, eliminada junto con
  // buildReportDetailSummaryQuery/buildReportDetailRelatedQuery y el caso
  // entity==="reports" de /api/search/detail.

  if (data.entity === "tickets") {
    return (
      <div className="flex flex-col gap-4 text-sm">
        <dl className="grid grid-cols-2 gap-2">
          <dt style={LABEL_STYLE}>Estado</dt>
          <dd>
            <StatusBadge label={data.summary.status ?? "Sin estado"} tone={ticketStatusTone(data.summary.status)} size="sm" />
          </dd>
          <dt style={LABEL_STYLE}>Cliente</dt>
          <dd className={VALUE_CLASS}>{data.summary.clientName ?? "—"}</dd>
          <dt style={LABEL_STYLE}>Fecha</dt>
          <dd className={VALUE_CLASS}>{formatDateEsCl(data.summary.date)}</dd>
        </dl>
        <section>
          <SectionTitle>Reportes vinculados</SectionTitle>
          <ul className="flex flex-col">
            {data.linkedReports.map(r => (
              <DetailListItem key={r.key} primary={`#${r.fieldbeatTaskId} · ${formatDateEsCl(r.date)}`} secondary={r.taskType ?? "—"} onClick={() => onOpenReport(r.fieldbeatTaskId)} />
            ))}
            {data.linkedReports.length === 0 && <EmptyListItem>Sin reportes vinculados.</EmptyListItem>}
          </ul>
        </section>
      </div>
    );
  }

  // parts
  return (
    <div className="flex flex-col gap-4 text-sm">
      <dl className="grid grid-cols-2 gap-2">
        <dt style={LABEL_STYLE}>SKU</dt>
        <dd className={VALUE_CLASS}>{data.summary.sku ?? "—"}</dd>
        <dt style={LABEL_STYLE}>Identificador crudo</dt>
        <dd className={VALUE_CLASS}>{data.summary.rawIdentifier ?? "—"}</dd>
        <dt style={LABEL_STYLE}>Cantidad consumida</dt>
        <dd className={VALUE_CLASS}>{data.summary.quantityConsumed.toLocaleString("es-CL")}</dd>
        <dt style={LABEL_STYLE}>Reportes</dt>
        <dd className={VALUE_CLASS}>{data.summary.reportCount.toLocaleString("es-CL")}</dd>
        <dt style={LABEL_STYLE}>Clientes</dt>
        <dd className={VALUE_CLASS}>{data.summary.clientCount.toLocaleString("es-CL")}</dd>
      </dl>
      <section>
        <SectionTitle>Usos recientes</SectionTitle>
        <ul className="flex flex-col">
          {data.recentUsages.map(r => (
            <DetailListItem key={r.key} primary={`#${r.fieldbeatTaskId} · ${formatDateEsCl(r.date)}`} secondary={r.clientName ?? "—"} onClick={() => onOpenReport(r.fieldbeatTaskId)} />
          ))}
          {data.recentUsages.length === 0 && <EmptyListItem>Sin usos registrados.</EmptyListItem>}
        </ul>
      </section>
    </div>
  );
}

function titleForRequest(entity: Exclude<SearchEntity, "all">, state: DetailState): string {
  if (state.status !== "success") return "Detalle";
  const data = state.data;
  if (data.entity === "clients") return data.summary.clientName;
  if (data.entity === "machines") return data.summary.machineId;
  if (data.entity === "tickets") return resolveTicketTitle(data.summary.title, data.summary.ticketId);
  return data.summary.partName || data.summary.sku || "Repuesto";
}

// Ciclo de vida propio (closed|loading|success|error), independiente del
// de la búsqueda principal, con su propio AbortController - abrir el
// drawer nunca cancela la búsqueda en curso y viceversa.
export function SearchDetailDrawerContainer({ request, onClose, onOpenReport }: SearchDetailDrawerContainerProps) {
  const [state, setState] = useState<DetailState>({ status: "closed" });
  const [retryCount, setRetryCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    if (!request) {
      setState({ status: "closed" });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: "loading" });

    const qs = new URLSearchParams({ entity: request.entity, key: request.key });
    fetch(`/api/search/detail?${qs.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async res => {
        const body: unknown = await res.json();
        if (!res.ok) {
          const message = typeof body === "object" && body && "error" in body ? String((body as Record<string, unknown>).error) : "Error desconocido";
          setState({ status: "error", message });
          return;
        }
        if (!isSearchDetailResponse(body)) {
          setState({ status: "error", message: "Respuesta de detalle con forma inesperada." });
          return;
        }
        setState({ status: "success", data: body });
      })
      .catch(error => {
        if (error?.name === "AbortError") return;
        setState({ status: "error", message: "No se pudo cargar el detalle." });
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, retryCount]);

  const isOpen = request !== null && state.status !== "closed";

  return (
    <DetailDrawer
      open={isOpen}
      onClose={onClose}
      title={request ? titleForRequest(request.entity, state) : "Detalle"}
      footerNote={GLOBAL_NOTE}
    >
      <div style={DETAIL_SURFACE_STYLE}>
        <DetailBody state={state} onRetry={() => setRetryCount(c => c + 1)} onOpenReport={onOpenReport} />
      </div>
    </DetailDrawer>
  );
}
