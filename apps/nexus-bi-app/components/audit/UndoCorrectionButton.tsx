"use client";

import { useState } from "react";

interface UndoCorrectionButtonProps {
  correctionVersionId: number;
  /** Versión esperada del correction_target al momento de reversar (concurrencia
   * optimista, B14/B58) - opcional porque no todo caller conoce la versión del
   * target en ese momento (ej. justo tras crear la primera versión, es 1). */
  expectedVersion?: number;
  onReversed?: () => void;
}

// Gate B - Familia 5: reversión GENÉRICA de una corrección
// (governance.fn_reverse_correction vía POST /api/audit/corrections/reverse) -
// componente único reutilizado por los 4 drawers de corrección (alias de
// repuesto, identidad de técnico, vínculo de ticket, identificación de
// equipo) para no duplicar la lógica de reversión en cada uno. Inline,
// nunca un segundo drawer apilado (B22) ni window.prompt/confirm.
export function UndoCorrectionButton({ correctionVersionId, expectedVersion, onReversed }: UndoCorrectionButtonProps) {
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reversed, setReversed] = useState(false);

  if (reversed) {
    return (
      <p className="text-sm" style={{ color: "var(--nx-text-secondary)" }}>
        Corrección revertida - se registró una nueva versión de reversión.
      </p>
    );
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="self-start rounded-full border px-3 py-1.5 text-xs font-semibold"
        style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-primary)" }}
      >
        Deshacer esta corrección
      </button>
    );
  }

  async function handleConfirm() {
    if (!reason.trim()) {
      setError("Se requiere una razón para este comando.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/audit/corrections/reverse", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ correctionVersionId, reason: reason.trim(), expectedVersion })
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body?.error ?? "No se pudo revertir la corrección.");
        return;
      }
      setReversed(true);
      onReversed?.();
    } catch {
      setError("Error de red - la reversión no se envió.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 rounded border p-2" style={{ borderColor: "var(--nx-border)" }}>
      <span className="text-xs font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
        Razón de la reversión (obligatoria)
      </span>
      <textarea
        rows={2}
        value={reason}
        onChange={event => setReason(event.target.value)}
        className="rounded border px-2 py-1 text-sm"
        style={{ borderColor: "var(--nx-border)" }}
      />
      {error && (
        <div className="rounded border px-2 py-1 text-xs" style={{ borderColor: "var(--nx-danger, #c0392b)", color: "var(--nx-danger, #c0392b)" }}>
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setExpanded(false)} className="rounded-full border px-2.5 py-1 text-xs" style={{ borderColor: "var(--nx-border)" }}>
          Cancelar
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={handleConfirm}
          className="rounded-full px-2.5 py-1 text-xs font-semibold text-white"
          style={{ background: "var(--nx-accent, #4a55d4)" }}
        >
          {submitting ? "Revirtiendo…" : "Confirmar reversión"}
        </button>
      </div>
    </div>
  );
}
