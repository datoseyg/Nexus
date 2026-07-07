"use client";

import { useEffect, useState } from "react";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { StatusBadge, matchStatusBadge } from "@/components/ui/StatusBadge";
import { LifecycleConfidenceBadge } from "./LifecycleConfidenceBadge";
import type { EquipmentLifecycleEventRow } from "@/types/equipment-lifecycle";
import type { PaginatedResponse } from "@/types/audit";

interface LifecycleEventsTableProps {
  equipment?: string;
  dolibarrRef?: string;
  client?: string;
}

function toQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return search.toString();
}

// Tabla de eventos base (Parte 8.8) - todos los eventos usados (o
// candidatos) para el cálculo, con su match_status y confiabilidad
// visibles, para trazabilidad completa. Clon estructural de
// AfterHoursDetailTable.tsx.
export function LifecycleEventsTable({ equipment, dolibarrRef, client }: LifecycleEventsTableProps) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PaginatedResponse<EquipmentLifecycleEventRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const query = toQuery({ page: String(page), pageSize: "20", equipment, dolibarrRef, client });

    fetch(`/api/dashboard/equipment-lifecycle/detail-events?${query}`)
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw body;
        setData(body);
      })
      .catch(body => setError(body?.error ?? "Error desconocido"))
      .finally(() => setLoading(false));
  }, [equipment, dolibarrRef, client, page]);

  useEffect(() => {
    setPage(1);
  }, [equipment, dolibarrRef, client]);

  return (
    <ResponsiveTableShell
      title="Eventos base usados en el cálculo"
      count={data?.totalRows}
      loading={loading}
      error={error}
      empty={!loading && !error && (data?.rows.length ?? 0) === 0}
      emptyMessage="Sin eventos para este filtro."
      maxHeight={480}
      footer={
        data && (
          <>
            <span>Página {data.page} de {data.totalPages}</span>
            <button type="button" onClick={() => setPage(p => p - 1)} disabled={page <= 1} className="rounded border px-2" style={{ borderColor: "var(--eyg-border)" }}>
              ‹
            </button>
            <button type="button" onClick={() => setPage(p => p + 1)} disabled={page >= data.totalPages} className="rounded border px-2" style={{ borderColor: "var(--eyg-border)" }}>
              ›
            </button>
          </>
        )
      }
    >
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Task</th>
            <th>Cliente</th>
            <th>Máquina</th>
            <th>Repuesto</th>
            <th>Cantidad</th>
            <th>Tipo tarea</th>
            <th>Técnico</th>
            <th>Match</th>
            <th>Asociación</th>
            <th>Confianza</th>
            <th>Notas</th>
          </tr>
        </thead>
        <tbody>
          {data?.rows.map(row => {
            const status = matchStatusBadge(row.match_status);
            return (
              <tr key={row.lifecycle_event_id}>
                <td>{row.event_date ? row.event_date.slice(0, 10) : "-"}</td>
                <td>{row.fieldbeat_task_id}</td>
                <td title={row.client_name ?? ""}>{row.client_name ?? "-"}</td>
                <td>{row.equipment_internal_id ?? "-"}</td>
                <td title={row.dolibarr_label ?? row.part_name ?? ""}>{row.dolibarr_ref ?? row.part_name ?? "-"}</td>
                <td>{row.quantity ?? "-"}</td>
                <td>{row.task_type ?? "-"}</td>
                <td>{row.technician_names ?? "-"}</td>
                <td>
                  <StatusBadge label={status.label} tone={status.tone} size="sm" />
                </td>
                <td>{row.association_confidence_label}</td>
                <td>
                  <LifecycleConfidenceBadge score={row.association_confidence_score} label={row.association_confidence_label} size="sm" />
                </td>
                <td title={row.calculation_notes ?? ""}>{row.calculation_notes ? "ver detalle" : "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ResponsiveTableShell>
  );
}
