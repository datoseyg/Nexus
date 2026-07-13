"use client";

import { useEffect, useRef, useState } from "react";
import { DetailDrawer } from "@/components/ui/DetailDrawer";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { BUTTON_SECONDARY } from "./search.styles";
import { isSearchDetailResponse, type DetailState } from "./search.types";
import { formatDateEsCl, resolveTicketTitle, splitEquipmentIds, ticketStatusTone } from "./search.utils";
import type { SearchEntity } from "@/types/search";

interface SearchDetailDrawerContainerProps {
  request: { entity: Exclude<SearchEntity, "all">; key: string } | null;
  onClose: () => void;
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

/** Fila de lista de 2 líneas (primaria oscura/semibold + secundaria legible) - reemplaza el patrón de una sola línea en gris parejo. */
function DetailListItem({ primary, secondary }: { primary: React.ReactNode; secondary?: React.ReactNode }) {
  return (
    <li className="-mx-2 rounded-[var(--nx-radius-chip)] border-b px-2 py-2 last:border-b-0 hover:bg-[var(--nx-page-bg)]" style={{ borderColor: "var(--nx-border)" }}>
      <p className="text-[13.5px] font-semibold" style={{ color: "var(--nx-text-primary)" }}>
        {primary}
      </p>
      {secondary && (
        <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--nx-text-secondary)" }}>
          {secondary}
        </p>
      )}
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

function DetailBody({ state, onRetry }: { state: DetailState; onRetry: () => void }) {
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
              <DetailListItem key={r.key} primary={`#${r.fieldbeatTaskId} · ${formatDateEsCl(r.date)}`} secondary={r.taskType ?? "—"} />
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
              <DetailListItem key={r.key} primary={`#${r.fieldbeatTaskId} · ${formatDateEsCl(r.date)}`} secondary={r.clientName ?? "—"} />
            ))}
            {data.recentReports.length === 0 && <EmptyListItem>Sin reportes.</EmptyListItem>}
          </ul>
        </section>
      </div>
    );
  }

  if (data.entity === "reports") {
    const machines = splitEquipmentIds(data.summary.machineId);
    return (
      <div className="flex flex-col gap-4 text-sm">
        <dl className="grid grid-cols-2 gap-2">
          <dt style={LABEL_STYLE}>Fecha</dt>
          <dd className={VALUE_CLASS}>{formatDateEsCl(data.summary.date)}</dd>
          <dt style={LABEL_STYLE}>Cliente</dt>
          <dd className={VALUE_CLASS}>{data.summary.clientName ?? "—"}</dd>
          <dt style={LABEL_STYLE}>Máquina(s)</dt>
          <dd className={VALUE_CLASS}>{machines.length ? machines.join(", ") : "—"}</dd>
          <dt style={LABEL_STYLE}>Tipo de tarea</dt>
          <dd className={VALUE_CLASS}>{data.summary.taskType ?? "—"}</dd>
          <dt style={LABEL_STYLE}>Ticket</dt>
          <dd className={VALUE_CLASS}>{data.summary.ticketId ?? "Sin ticket asociado"}</dd>
        </dl>
        <section>
          <SectionTitle>Campos del reporte</SectionTitle>
          <dl className="grid grid-cols-2 gap-1.5 text-[13px]">
            {data.fields.map((f, i) => (
              <div key={i} className="contents">
                <dt style={LABEL_STYLE}>{f.label}</dt>
                <dd style={{ color: "var(--nx-text-primary)" }}>{f.value ?? "—"}</dd>
              </div>
            ))}
          </dl>
          {data.fields.length === 0 && (
            <p className="text-[13px]" style={EMPTY_STYLE}>
              Sin campos adicionales.
            </p>
          )}
        </section>
        <section>
          <SectionTitle>Repuestos usados</SectionTitle>
          <ul className="flex flex-col">
            {data.parts.map(p => (
              <DetailListItem
                key={p.key}
                primary={p.partName ?? p.sku ?? p.rawIdentifier}
                secondary={`${p.quantityConsumed.toLocaleString("es-CL")} consumidos`}
              />
            ))}
            {data.parts.length === 0 && <EmptyListItem>Sin repuestos registrados.</EmptyListItem>}
          </ul>
        </section>
      </div>
    );
  }

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
              <DetailListItem key={r.key} primary={`#${r.fieldbeatTaskId} · ${formatDateEsCl(r.date)}`} secondary={r.taskType ?? "—"} />
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
            <DetailListItem key={r.key} primary={`#${r.fieldbeatTaskId} · ${formatDateEsCl(r.date)}`} secondary={r.clientName ?? "—"} />
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
  if (data.entity === "reports") return `Reporte #${data.summary.fieldbeatTaskId}`;
  if (data.entity === "tickets") return resolveTicketTitle(data.summary.title, data.summary.ticketId);
  return data.summary.partName || data.summary.sku || "Repuesto";
}

// Ciclo de vida propio (closed|loading|success|error), independiente del
// de la búsqueda principal, con su propio AbortController - abrir el
// drawer nunca cancela la búsqueda en curso y viceversa.
export function SearchDetailDrawerContainer({ request, onClose }: SearchDetailDrawerContainerProps) {
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
        <DetailBody state={state} onRetry={() => setRetryCount(c => c + 1)} />
      </div>
    </DetailDrawer>
  );
}
