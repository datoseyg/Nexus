"use client";

import { useEffect, useRef, useState } from "react";
import { DetailDrawer } from "@/components/ui/DetailDrawer";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { isSearchDetailResponse, type DetailState } from "./search.types";
import { formatDateEsCl, resolveTicketTitle, splitEquipmentIds, ticketStatusTone } from "./search.utils";
import type { SearchEntity } from "@/types/search";

interface SearchDetailDrawerContainerProps {
  request: { entity: Exclude<SearchEntity, "all">; key: string } | null;
  onClose: () => void;
}

const GLOBAL_NOTE = "Esta vista muestra el estado global de la entidad, sin aplicar los filtros de búsqueda actuales.";

function DetailBody({ state }: { state: DetailState }) {
  if (state.status === "loading") {
    return (
      <p aria-busy="true" style={{ color: "var(--nx-text-secondary)" }}>
        Cargando detalle…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div role="alert" style={{ color: "var(--nx-danger-fg)" }}>
        {state.message}
      </div>
    );
  }
  if (state.status !== "success") return null;

  const data = state.data;

  if (data.entity === "clients") {
    return (
      <div className="flex flex-col gap-4 text-sm">
        <dl className="grid grid-cols-2 gap-2">
          <dt style={{ color: "var(--nx-text-muted)" }}>Reportes</dt>
          <dd>{data.summary.reportCount.toLocaleString("es-CL")}</dd>
          <dt style={{ color: "var(--nx-text-muted)" }}>Tickets</dt>
          <dd>{data.summary.ticketCount.toLocaleString("es-CL")}</dd>
          <dt style={{ color: "var(--nx-text-muted)" }}>Máquinas</dt>
          <dd>{data.summary.machineCount.toLocaleString("es-CL")}</dd>
        </dl>
        <section>
          <h3 className="mb-1 text-xs font-bold uppercase" style={{ color: "var(--nx-text-muted)" }}>
            Reportes recientes
          </h3>
          <ul className="flex flex-col gap-1.5">
            {data.recentReports.map(r => (
              <li key={r.key} className="text-[13px]">
                #{r.fieldbeatTaskId} · {formatDateEsCl(r.date)} · {r.taskType ?? "—"}
              </li>
            ))}
            {data.recentReports.length === 0 && <li className="text-[13px]" style={{ color: "var(--nx-text-muted)" }}>Sin reportes.</li>}
          </ul>
        </section>
        <section>
          <h3 className="mb-1 text-xs font-bold uppercase" style={{ color: "var(--nx-text-muted)" }}>
            Máquinas
          </h3>
          <ul className="flex flex-col gap-1.5">
            {data.machines.map(m => (
              <li key={m.key} className="text-[13px]">
                {m.machineId} · {m.reportCount.toLocaleString("es-CL")} reportes
              </li>
            ))}
            {data.machines.length === 0 && <li className="text-[13px]" style={{ color: "var(--nx-text-muted)" }}>Sin máquinas.</li>}
          </ul>
        </section>
        <section>
          <h3 className="mb-1 text-xs font-bold uppercase" style={{ color: "var(--nx-text-muted)" }}>
            Tickets
          </h3>
          <ul className="flex flex-col gap-1.5">
            {data.tickets.map(t => (
              <li key={t.key} className="flex items-center gap-2 text-[13px]">
                <StatusBadge label={t.status ?? "Sin estado"} tone={ticketStatusTone(t.status)} size="sm" />
                {resolveTicketTitle(t.title, t.ticketId)}
              </li>
            ))}
            {data.tickets.length === 0 && <li className="text-[13px]" style={{ color: "var(--nx-text-muted)" }}>Sin tickets vinculados.</li>}
          </ul>
        </section>
      </div>
    );
  }

  if (data.entity === "machines") {
    return (
      <div className="flex flex-col gap-4 text-sm">
        <dl className="grid grid-cols-2 gap-2">
          <dt style={{ color: "var(--nx-text-muted)" }}>Cliente</dt>
          <dd>{data.summary.clientName ?? "—"}</dd>
          <dt style={{ color: "var(--nx-text-muted)" }}>Reportes</dt>
          <dd>{data.summary.reportCount.toLocaleString("es-CL")}</dd>
          <dt style={{ color: "var(--nx-text-muted)" }}>Tickets</dt>
          <dd>{data.summary.ticketCount.toLocaleString("es-CL")}</dd>
        </dl>
        <section>
          <h3 className="mb-1 text-xs font-bold uppercase" style={{ color: "var(--nx-text-muted)" }}>
            Reportes recientes
          </h3>
          <ul className="flex flex-col gap-1.5">
            {data.recentReports.map(r => (
              <li key={r.key} className="text-[13px]">
                #{r.fieldbeatTaskId} · {formatDateEsCl(r.date)} · {r.clientName ?? "—"}
              </li>
            ))}
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
          <dt style={{ color: "var(--nx-text-muted)" }}>Fecha</dt>
          <dd>{formatDateEsCl(data.summary.date)}</dd>
          <dt style={{ color: "var(--nx-text-muted)" }}>Cliente</dt>
          <dd>{data.summary.clientName ?? "—"}</dd>
          <dt style={{ color: "var(--nx-text-muted)" }}>Máquina(s)</dt>
          <dd>{machines.length ? machines.join(", ") : "—"}</dd>
          <dt style={{ color: "var(--nx-text-muted)" }}>Tipo de tarea</dt>
          <dd>{data.summary.taskType ?? "—"}</dd>
          <dt style={{ color: "var(--nx-text-muted)" }}>Ticket</dt>
          <dd>{data.summary.ticketId ?? "Sin ticket asociado"}</dd>
        </dl>
        <section>
          <h3 className="mb-1 text-xs font-bold uppercase" style={{ color: "var(--nx-text-muted)" }}>
            Campos del reporte
          </h3>
          <dl className="grid grid-cols-2 gap-1.5 text-[13px]">
            {data.fields.map((f, i) => (
              <div key={i} className="contents">
                <dt style={{ color: "var(--nx-text-muted)" }}>{f.label}</dt>
                <dd>{f.value ?? "—"}</dd>
              </div>
            ))}
          </dl>
          {data.fields.length === 0 && <p className="text-[13px]" style={{ color: "var(--nx-text-muted)" }}>Sin campos adicionales.</p>}
        </section>
        <section>
          <h3 className="mb-1 text-xs font-bold uppercase" style={{ color: "var(--nx-text-muted)" }}>
            Repuestos usados
          </h3>
          <ul className="flex flex-col gap-1.5">
            {data.parts.map(p => (
              <li key={p.key} className="text-[13px]">
                {p.partName ?? p.sku ?? p.rawIdentifier} · {p.quantityConsumed.toLocaleString("es-CL")}
              </li>
            ))}
            {data.parts.length === 0 && <li className="text-[13px]" style={{ color: "var(--nx-text-muted)" }}>Sin repuestos registrados.</li>}
          </ul>
        </section>
      </div>
    );
  }

  if (data.entity === "tickets") {
    return (
      <div className="flex flex-col gap-4 text-sm">
        <dl className="grid grid-cols-2 gap-2">
          <dt style={{ color: "var(--nx-text-muted)" }}>Estado</dt>
          <dd>
            <StatusBadge label={data.summary.status ?? "Sin estado"} tone={ticketStatusTone(data.summary.status)} size="sm" />
          </dd>
          <dt style={{ color: "var(--nx-text-muted)" }}>Cliente</dt>
          <dd>{data.summary.clientName ?? "—"}</dd>
          <dt style={{ color: "var(--nx-text-muted)" }}>Fecha</dt>
          <dd>{formatDateEsCl(data.summary.date)}</dd>
        </dl>
        <section>
          <h3 className="mb-1 text-xs font-bold uppercase" style={{ color: "var(--nx-text-muted)" }}>
            Reportes vinculados
          </h3>
          <ul className="flex flex-col gap-1.5">
            {data.linkedReports.map(r => (
              <li key={r.key} className="text-[13px]">
                #{r.fieldbeatTaskId} · {formatDateEsCl(r.date)} · {r.taskType ?? "—"}
              </li>
            ))}
            {data.linkedReports.length === 0 && <li className="text-[13px]" style={{ color: "var(--nx-text-muted)" }}>Sin reportes vinculados.</li>}
          </ul>
        </section>
      </div>
    );
  }

  // parts
  return (
    <div className="flex flex-col gap-4 text-sm">
      <dl className="grid grid-cols-2 gap-2">
        <dt style={{ color: "var(--nx-text-muted)" }}>SKU</dt>
        <dd>{data.summary.sku ?? "—"}</dd>
        <dt style={{ color: "var(--nx-text-muted)" }}>Identificador crudo</dt>
        <dd>{data.summary.rawIdentifier ?? "—"}</dd>
        <dt style={{ color: "var(--nx-text-muted)" }}>Cantidad consumida</dt>
        <dd>{data.summary.quantityConsumed.toLocaleString("es-CL")}</dd>
        <dt style={{ color: "var(--nx-text-muted)" }}>Reportes</dt>
        <dd>{data.summary.reportCount.toLocaleString("es-CL")}</dd>
        <dt style={{ color: "var(--nx-text-muted)" }}>Clientes</dt>
        <dd>{data.summary.clientCount.toLocaleString("es-CL")}</dd>
      </dl>
      <section>
        <h3 className="mb-1 text-xs font-bold uppercase" style={{ color: "var(--nx-text-muted)" }}>
          Usos recientes
        </h3>
        <ul className="flex flex-col gap-1.5">
          {data.recentUsages.map(r => (
            <li key={r.key} className="text-[13px]">
              #{r.fieldbeatTaskId} · {formatDateEsCl(r.date)} · {r.clientName ?? "—"}
            </li>
          ))}
          {data.recentUsages.length === 0 && <li className="text-[13px]" style={{ color: "var(--nx-text-muted)" }}>Sin usos registrados.</li>}
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
  }, [request]);

  const isOpen = request !== null && state.status !== "closed";

  return (
    <DetailDrawer
      open={isOpen}
      onClose={onClose}
      title={request ? titleForRequest(request.entity, state) : "Detalle"}
      footerNote={GLOBAL_NOTE}
    >
      <DetailBody state={state} />
    </DetailDrawer>
  );
}
