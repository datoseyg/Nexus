"use client";

import { useEffect, useMemo, useState } from "react";
import { DetailDrawer } from "@/components/ui/DetailDrawer";
import { UndoCorrectionButton } from "./UndoCorrectionButton";

/** El comando (correction:part-alias) se identifica por raw_part_identifier
 * (alias GLOBAL, nunca por ocurrencia) - fieldbeat_task_id es puramente
 * cosmético (título del drawer) y no siempre existe: PartsReviewRow trae
 * una ocurrencia concreta, pero AmbiguousPartsSection agrupa por
 * raw_part_identifier a través de muchas ocurrencias/reportes, sin una
 * tarea única que mostrar. Cualquier fila de cualquier pestaña que
 * comparta esta forma mínima puede abrir este mismo drawer - nunca un
 * drawer de corrección paralelo por pestaña. */
export interface PartAliasCorrectionTarget {
  raw_part_identifier: string | null;
  fieldbeat_task_id?: number;
}

interface PartAliasCorrectionDrawerProps {
  open: boolean;
  row: PartAliasCorrectionTarget | null;
  onClose: () => void;
  onApplied: () => void;
}

type AliasType = "RAW" | "NORMALIZED";

// Gate B - primer comando de corrección conectado a UI (correction:part-alias,
// POST /api/audit/corrections/part-alias). Reutiliza el DetailDrawer
// canónico (components/ui/DetailDrawer.tsx) - nunca un modal paralelo.
// El Idempotency-Key se genera UNA vez por apertura del drawer (mismo row) y
// se reutiliza en reintentos de ESA sesión; si el servidor responde
// IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY (el usuario cambió algo entre
// reintentos), se le pide cerrar y reabrir el drawer para obtener una clave
// nueva - más simple y seguro que intentar adivinar cuándo regenerarla.
//
// Aplicar la corrección NUNCA marca el issue resuelto de inmediato (B9/B21.5
// del diseño) - la verificación ocurre después, vía el outbox
// (governance-verification-worker.mjs). Esta UI solo confirma "corrección
// registrada", nunca "problema resuelto".
export function PartAliasCorrectionDrawer({ open, row, onClose, onApplied }: PartAliasCorrectionDrawerProps) {
  const [aliasType, setAliasType] = useState<AliasType>("RAW");
  const [aliasValue, setAliasValue] = useState("");
  const [dolibarrProductId, setDolibarrProductId] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [correctionVersionId, setCorrectionVersionId] = useState<number | null>(null);

  const idempotencyKey = useMemo(() => crypto.randomUUID(), [open, row?.raw_part_identifier]);

  // Se resetea cada vez que el drawer se ABRE para un row dado - nunca al
  // cerrar (evita depender de un setTimeout para que el usuario alcance a
  // ver el mensaje de éxito antes de que el formulario se limpie).
  useEffect(() => {
    if (!open) return;
    setAliasType("RAW");
    setAliasValue(row?.raw_part_identifier ?? "");
    setDolibarrProductId("");
    setReason("");
    setError(null);
    setApplied(false);
    setCorrectionVersionId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.raw_part_identifier]);

  if (!row) return null;

  function handleClose() {
    onClose();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/audit/corrections/part-alias", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({
          aliasValue,
          aliasType,
          dolibarrProductId: Number(dolibarrProductId),
          reason
        })
      });

      const body = await response.json();

      if (!response.ok) {
        setError(body?.error ?? "No se pudo aplicar la corrección.");
        return;
      }

      setApplied(true);
      setCorrectionVersionId(typeof body?.correctionVersionId === "number" ? body.correctionVersionId : null);
      onApplied();
    } catch {
      setError("Error de red - la corrección no se envió.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DetailDrawer
      open={open}
      onClose={handleClose}
      title={row.fieldbeat_task_id ? `Alias de repuesto - tarea ${row.fieldbeat_task_id}` : `Alias de repuesto - ${row.raw_part_identifier}`}
      footerNote="La corrección se registra de inmediato; la incidencia permanece en revisión hasta que la regla confirme que ya no detecta el problema."
    >
      {applied ? (
        <div className="flex flex-col gap-3">
          <p style={{ color: "var(--nx-text-primary)" }}>
            Corrección registrada. Verificación en curso - la incidencia se resolverá automáticamente cuando la
            regla confirme que el repuesto ya no aparece sin match.
          </p>
          {correctionVersionId && <UndoCorrectionButton correctionVersionId={correctionVersionId} onReversed={onApplied} />}
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full border px-3 py-1.5 text-sm font-semibold"
            style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-primary)" }}
          >
            Cerrar
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <div className="text-xs font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
              Identificador crudo original
            </div>
            <div style={{ color: "var(--nx-text-primary)" }}>{row.raw_part_identifier ?? "-"}</div>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
              Tipo de alias
            </span>
            <select
              value={aliasType}
              onChange={event => setAliasType(event.target.value as AliasType)}
              className="rounded border px-2 py-1.5"
              style={{ borderColor: "var(--nx-border)" }}
            >
              <option value="RAW">RAW (código crudo exacto)</option>
              <option value="NORMALIZED">NORMALIZED (código normalizado)</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
              Valor del alias
            </span>
            <input
              type="text"
              required
              value={aliasValue}
              onChange={event => setAliasValue(event.target.value)}
              className="rounded border px-2 py-1.5"
              style={{ borderColor: "var(--nx-border)" }}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
              Producto Dolibarr correcto (ID)
            </span>
            <input
              type="number"
              required
              value={dolibarrProductId}
              onChange={event => setDolibarrProductId(event.target.value)}
              className="rounded border px-2 py-1.5"
              style={{ borderColor: "var(--nx-border)" }}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
              Razón (obligatoria)
            </span>
            <textarea
              required
              rows={3}
              value={reason}
              onChange={event => setReason(event.target.value)}
              className="rounded border px-2 py-1.5"
              style={{ borderColor: "var(--nx-border)" }}
            />
          </label>

          {error && (
            <div className="rounded border px-2 py-1.5 text-sm" style={{ borderColor: "var(--nx-danger, #c0392b)", color: "var(--nx-danger, #c0392b)" }}>
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-full border px-3 py-1.5 text-sm font-semibold"
              style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-primary)" }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-full px-3 py-1.5 text-sm font-semibold text-white"
              style={{ background: "var(--nx-accent, #4a55d4)" }}
            >
              {submitting ? "Aplicando…" : "Aplicar corrección"}
            </button>
          </div>
        </form>
      )}
    </DetailDrawer>
  );
}
