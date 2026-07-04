"use client";

import { useEffect, useState } from "react";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { StatusBadge, calculationStatusBadge } from "@/components/ui/StatusBadge";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";
import type { AfterHoursDetailRow } from "@/types/after-hours";
import type { PaginatedResponse } from "@/types/audit";
import type { AfterHoursFilterValues } from "./AfterHoursFilterBar";

interface AfterHoursDetailTableProps {
  filters: AfterHoursFilterValues;
}

function toQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return search.toString();
}

function round1(value: number | null): string {
  if (value === null || value === undefined) return "-";
  return (Math.round(value * 10) / 10).toString();
}

// Tabla de detalle de tareas fuera de horario - clon estructural de
// PartsReviewSection.tsx (mismo patrón de fetch/paginación/estado). Fuente:
// marts.fieldbeat_working_hours_analysis vía /api/dashboard/after-hours/detail.
export function AfterHoursDetailTable({ filters }: AfterHoursDetailTableProps) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PaginatedResponse<AfterHoursDetailRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const query = toQuery({
      page: String(page),
      pageSize: "20",
      client: filters.client,
      technician: filters.technician,
      taskType: filters.taskType,
      from: filters.from,
      to: filters.to,
      confidenceLevel: filters.confidenceLevel,
      onlyAfterHours: filters.onlyAfterHours,
      onlyLowConfidence: filters.onlyLowConfidence
    });

    fetch(`/api/dashboard/after-hours/detail?${query}`)
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw body;
        setData(body);
      })
      .catch(body => setError(body?.error ?? "Error desconocido"))
      .finally(() => setLoading(false));
  }, [filters, page]);

  useEffect(() => {
    setPage(1);
  }, [filters]);

  return (
    <ResponsiveTableShell
      title="Detalle de tareas fuera de horario"
      count={data?.totalRows}
      loading={loading}
      error={error}
      empty={!loading && !error && (data?.rows.length ?? 0) === 0}
      emptyMessage="Sin tareas para este filtro."
      maxHeight={520}
      footer={
        data && (
          <>
            <span>
              Página {data.page} de {data.totalPages}
            </span>
            <button type="button" onClick={() => setPage(p => p - 1)} disabled={page <= 1} className="rounded border px-2" style={{ borderColor: "var(--eyg-border)" }}>
              ‹
            </button>
            <button
              type="button"
              onClick={() => setPage(p => p + 1)}
              disabled={page >= data.totalPages}
              className="rounded border px-2"
              style={{ borderColor: "var(--eyg-border)" }}
            >
              ›
            </button>
          </>
        )
      }
    >
      <table>
        <thead>
          <tr>
            <th>Tarea</th>
            <th>Inicio</th>
            <th>Término estimado</th>
            <th>Cliente</th>
            <th>Equipo</th>
            <th>Técnico</th>
            <th>Tipo</th>
            <th>Duración (h)</th>
            <th>Hábil (h)</th>
            <th>Fuera de horario (h)</th>
            <th>Fin de semana (h)</th>
            <th>Feriado (h)</th>
            <th>% fuera de horario</th>
            <th>Estado del cálculo</th>
            <th>Confiabilidad</th>
          </tr>
        </thead>
        <tbody>
          {data?.rows.map(row => {
            const statusBadge = calculationStatusBadge(row.calculation_status);
            return (
              <tr key={row.fieldbeat_task_id}>
                <td>{row.fieldbeat_task_id}</td>
                <td>{row.start_time?.slice(0, 16) ?? "-"}</td>
                <td title={row.estimated_end_time ?? ""}>{row.estimated_end_time?.slice(0, 16) ?? "-"}</td>
                <td title={row.client_name ?? ""}>{row.client_name ?? "-"}</td>
                <td title={row.equipment_internal_ids ?? ""}>{row.equipment_internal_ids ?? "-"}</td>
                <td>{row.assigned_to ?? "-"}</td>
                <td>{row.task_type ?? "-"}</td>
                <td>{round1(row.duration_hours)}</td>
                <td>{round1(row.business_hours)}</td>
                <td>{round1(row.after_hours)}</td>
                <td>{round1(row.weekend_hours)}</td>
                <td>{round1(row.holiday_hours)}</td>
                <td>{row.after_hours_rate !== null ? `${Math.round(row.after_hours_rate * 100)}%` : "-"}</td>
                <td>
                  <StatusBadge label={statusBadge.label} tone={statusBadge.tone} />
                </td>
                <td>
                  {row.confidence_score !== null && (
                    <ConfidenceBadge score={row.confidence_score} label={row.confidence_label ?? "-"} factors={row.confidence_factors} size="sm" />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ResponsiveTableShell>
  );
}
