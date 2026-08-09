"use client";

import { useState } from "react";
import { UndoCorrectionButton } from "./UndoCorrectionButton";

interface EquipmentIdentificationCorrectionActionProps {
  fieldbeatTaskId: string;
  rawEquipmentReference: string | null;
  onCorrected?: () => void;
}

// Gate B - Familia 5: identificación de equipo (correction:equipment-identification,
// POST /api/audit/corrections/equipment-identification). Inline dentro de la
// sección "Equipos" del detalle de reporte (FieldbeatReportDetailContent) -
// nunca un segundo drawer apilado (B22). Sin regla de calidad asociada en v1
// (B8/B81): nunca promete una verificación automática. No crea una
// taxonomía de equipo nueva ni porta Equipment Lifecycle - el ID interno
// corregido es el mismo vocabulario ya usado por Explorador > Equipos.
export function EquipmentIdentificationCorrectionAction({ fieldbeatTaskId, rawEquipmentReference, onCorrected }: EquipmentIdentificationCorrectionActionProps) {
  const [expanded, setExpanded] = useState(false);
  const [correctedId, setCorrectedId] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correctionVersionId, setCorrectionVersionId] = useState<number | null>(null);

  if (correctionVersionId) {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-[13px]" style={{ color: "var(--nx-text-secondary)" }}>
          Corrección registrada en el historial de auditoría. No hay una regla de calidad de equipo en esta versión -
          este reporte seguirá mostrando la misma identificación ambigua hasta que exista una vista que aplique este
          overlay en vivo.
        </p>
        <UndoCorrectionButton correctionVersionId={correctionVersionId} onReversed={onCorrected} />
      </div>
    );
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="self-start rounded-[var(--nx-radius-chip)] border px-2.5 py-1 text-[12px] font-semibold"
        style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-primary)" }}
      >
        Corregir identificación de equipo
      </button>
    );
  }

  async function handleConfirm() {
    if (!correctedId.trim()) {
      setError("El ID interno de equipo correcto es obligatorio.");
      return;
    }
    if (!reason.trim()) {
      setError("Se requiere una razón para este comando.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/audit/corrections/equipment-identification", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          fieldbeatTaskId: Number(fieldbeatTaskId),
          rawEquipmentReference,
          correctedEquipmentInternalId: correctedId.trim(),
          reason: reason.trim()
        })
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body?.error ?? "No se pudo aplicar la corrección.");
        return;
      }
      setCorrectionVersionId(typeof body?.correctionVersionId === "number" ? body.correctionVersionId : null);
      onCorrected?.();
    } catch {
      setError("Error de red - la corrección no se envió.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-[var(--nx-radius-chip)] border p-2" style={{ borderColor: "var(--nx-border)" }}>
      <label className="flex flex-col gap-1 text-[12px]">
        <span className="font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
          ID interno de equipo correcto (mismo vocabulario que Explorador &gt; Equipos)
        </span>
        <input
          type="text"
          value={correctedId}
          onChange={event => setCorrectedId(event.target.value)}
          className="rounded border px-2 py-1"
          style={{ borderColor: "var(--nx-border)" }}
        />
      </label>
      <label className="flex flex-col gap-1 text-[12px]">
        <span className="font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
          Razón (obligatoria)
        </span>
        <textarea
          rows={2}
          value={reason}
          onChange={event => setReason(event.target.value)}
          className="rounded border px-2 py-1"
          style={{ borderColor: "var(--nx-border)" }}
        />
      </label>
      {error && (
        <div className="rounded border px-2 py-1 text-[12px]" style={{ borderColor: "var(--nx-danger, #c0392b)", color: "var(--nx-danger, #c0392b)" }}>
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setExpanded(false)} className="rounded-full border px-2.5 py-1 text-[12px]" style={{ borderColor: "var(--nx-border)" }}>
          Cancelar
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={handleConfirm}
          className="rounded-full px-2.5 py-1 text-[12px] font-semibold text-white"
          style={{ background: "var(--nx-accent, #4a55d4)" }}
        >
          {submitting ? "Aplicando…" : "Confirmar"}
        </button>
      </div>
    </div>
  );
}
