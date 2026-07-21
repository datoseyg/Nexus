"use client";

import { DetailDrawer } from "@/components/ui/DetailDrawer";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getCoverageClassificationLabel, getDataBasisLabel, getFallbackLabel, getReasonCodeLabel, getConfidenceTierLabel } from "@/lib/after-hours-labels";
import { formatHoursOrDash, totalAfterHoursHours } from "@/lib/after-hours-detail-view";
import type { AfterHoursDetailRow } from "@/types/after-hours";

interface AfterHoursDrawerProps {
  row: AfterHoursDetailRow | null;
  onClose: () => void;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[13px]" style={{ color: "var(--nx-text-secondary)" }}>
        {label}
      </span>
      <span className="text-right text-[13px] font-semibold" style={{ color: "var(--nx-text-primary)" }}>
        {value}
      </span>
    </div>
  );
}

// Panel de detalle de un registro (ETAPA 6.6D §12) - sobre
// components/ui/DetailDrawer.tsx (overlay/Escape/backdrop/focus-trap ya
// implementados, sin conectar hasta ahora). Solo lectura, sin acciones de
// edición (§12: "No incluir acciones de edición").
export function AfterHoursDrawer({ row, onClose }: AfterHoursDrawerProps) {
  if (!row) return null;

  const dateStr = row.start_time ? row.start_time.replace(" ", "T").split("T")[0] : null;
  const startTime = row.start_time ? row.start_time.replace(" ", "T").split("T")[1]?.slice(0, 5) : null;
  const endTime = row.estimated_end_time ? row.estimated_end_time.replace(" ", "T").split("T")[1]?.slice(0, 5) : null;

  const dataBasis = getDataBasisLabel(row.data_basis);
  const coverage = getCoverageClassificationLabel(row.coverage_classification);
  const finalReason = getReasonCodeLabel(row.coverage_reason_code);
  const contractualReason = row.contractual_reason_code ? getReasonCodeLabel(row.contractual_reason_code) : null;
  const fallback = getFallbackLabel(row.fallback_used);
  const temporalConfidence = getConfidenceTierLabel(row.confidence_label);
  const contractualConfidence = row.data_basis === "CONTRACTUAL" ? getConfidenceTierLabel(row.contract_resolution_label) : null;

  return (
    <DetailDrawer
      open={row !== null}
      onClose={onClose}
      title={`Tarea #${row.fieldbeat_task_id}`}
      footerNote="Panel de solo lectura - no incluye acciones de modificación."
    >
      <div className="mb-3">
        <StatusBadge label={dataBasis.label} tone={dataBasis.severity} />
      </div>

      <div className="border-t pt-2" style={{ borderColor: "var(--nx-border)" }}>
        <Field label="Fecha" value={dateStr ?? "—"} />
        <Field label="Técnico" value={row.assigned_to ?? "—"} />
        <Field label="Cliente" value={row.client_name ?? "—"} />
        <Field label="Equipo" value={row.equipment_internal_ids ?? "—"} />
        <Field label="Tipo de tarea" value={row.task_type ?? "—"} />
        <Field label="Hora de inicio" value={startTime ?? "—"} />
        <Field label="Hora de término" value={endTime ?? "—"} />
        <Field label="Duración" value={formatHoursOrDash(row.duration_hours)} />
      </div>

      <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--nx-border)" }}>
        <Field label="Minutos cubiertos" value={formatHoursOrDash(row.business_hours)} />
        <Field label="Minutos fuera de cobertura" value={formatHoursOrDash(totalAfterHoursHours(row))} />
        <Field label="  · Día hábil fuera de horario" value={formatHoursOrDash(row.after_hours)} />
        <Field label="  · Fin de semana" value={formatHoursOrDash(row.weekend_hours)} />
        <Field label="  · Feriado" value={formatHoursOrDash(row.holiday_hours)} />
      </div>

      <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--nx-border)" }}>
        <Field label="Base de cálculo" value={dataBasis.label} />
        <Field label="Clasificación" value={coverage.label} />
        <Field label="Motivo final" value={finalReason.label} />
        {contractualReason && <Field label="Motivo contractual" value={contractualReason.label} />}
        <Field label="Horario de respaldo" value={fallback.label} />
      </div>

      <div className="mt-2 border-t pt-2" style={{ borderColor: "var(--nx-border)" }}>
        <Field
          label="Confianza temporal"
          value={
            row.confidence_score === null ? "—" : `${Math.round(row.confidence_score)} · ${temporalConfidence.label}`
          }
        />
        {contractualConfidence && (
          <Field
            label="Confianza contractual"
            value={row.contract_resolution_confidence === null ? "—" : `${Math.round(row.contract_resolution_confidence)} · ${contractualConfidence.label}`}
          />
        )}
      </div>

      <div className="mt-3 text-[13px]" style={{ color: "var(--nx-text-secondary)" }}>
        {finalReason.description}
      </div>
    </DetailDrawer>
  );
}
