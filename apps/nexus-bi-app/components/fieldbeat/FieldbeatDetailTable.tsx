"use client";

import { DataTableCard, type DataTableColumn } from "@/components/dashboard/DataTableCard";
import { SectionCard } from "@/components/ui/SectionCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatDateTimeEsCl, formatNumberEsCl } from "@/lib/dashboard-formatters";
import type { FieldbeatDetailRow } from "@/types/fieldbeat";

interface FieldbeatDetailTableProps {
  rows: FieldbeatDetailRow[];
  page: number;
  totalPages: number;
  totalRows: number;
  onPageChange: (page: number) => void;
  loading?: boolean;
}

const DASH = "-";

function text(value: string | null | undefined): string {
  return value && value.trim() !== "" ? value : DASH;
}

const COLUMNS: DataTableColumn<FieldbeatDetailRow>[] = [
  { key: "fecha", label: "Fecha y hora", minWidthPx: 150, render: row => formatDateTimeEsCl(row.fecha) },
  { key: "fieldbeat_task_id", label: "ID reporte", minWidthPx: 90 },
  { key: "tecnico", label: "Técnico", minWidthPx: 130, render: row => text(row.tecnico) },
  { key: "cliente", label: "Cliente", minWidthPx: 160, wrap: true, render: row => text(row.cliente) },
  { key: "equipo", label: "Equipo", minWidthPx: 140, breakWord: true, render: row => text(row.equipo) },
  { key: "tipo_tarea", label: "Tipo de tarea", minWidthPx: 150, render: row => text(row.tipo_tarea) },
  { key: "origen", label: "Origen", minWidthPx: 80, render: row => text(row.origen) },
  { key: "ticket", label: "Ticket", minWidthPx: 90, render: row => text(row.ticket) },
  { key: "sku", label: "SKU / repuesto", minWidthPx: 160, breakWord: true, render: row => text(row.sku) },
  { key: "cantidad_repuestos", label: "Cantidad", minWidthPx: 90, render: row => formatNumberEsCl(Number(row.cantidad_repuestos)) },
  { key: "estado", label: "Estado", minWidthPx: 140, render: row => text(row.estado) },
  {
    key: "hora_termino_estimada",
    label: "Hora término (estimada)",
    minWidthPx: 170,
    render: row => (row.hora_termino_estimada ? formatDateTimeEsCl(row.hora_termino_estimada) : DASH)
  }
];

// ETAPA 6 - reemplaza a FieldbeatUnavailableDetailTable.tsx (ETAPA 5-V).
// Fuente: /api/dashboard/fieldbeat/detail, paginado y filtrado (mismos
// filtros que el resto de la pantalla). "Hora término (estimada)" se
// rotula explícitamente como estimada - no existe una columna de hora de
// término real en el origen (ver diagnóstico Fase 2), se deriva de
// fecha + duration_minutes.
export function FieldbeatDetailTable({ rows, page, totalPages, totalRows, onPageChange, loading = false }: FieldbeatDetailTableProps) {
  if (loading && rows.length === 0) {
    return (
      <SectionCard title="Detalle de reportes">
        <div className="h-32 animate-pulse rounded" style={{ background: "var(--nx-page-bg)" }} />
      </SectionCard>
    );
  }

  if (!loading && totalRows === 0) {
    return (
      <SectionCard title="Detalle de reportes">
        <EmptyState title="Sin reportes para este filtro" description="Ajusta o limpia los filtros para ver resultados." />
      </SectionCard>
    );
  }

  return (
    <DataTableCard<FieldbeatDetailRow>
      title="Detalle de reportes"
      columns={COLUMNS}
      rows={rows}
      page={page}
      totalPages={totalPages}
      totalRows={totalRows}
      onPageChange={onPageChange}
      footerNote={`${formatNumberEsCl(totalRows)} reporte(s) para el filtro actual`}
      tableMinWidthPx={1400}
    />
  );
}
