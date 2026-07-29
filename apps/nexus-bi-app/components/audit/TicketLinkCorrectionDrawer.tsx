"use client";

import { useEffect, useMemo, useState } from "react";
import { DetailDrawer } from "@/components/ui/DetailDrawer";
import { UndoCorrectionButton } from "./UndoCorrectionButton";
import type { TicketLinkReviewRow } from "@/types/audit";

interface TicketLinkCorrectionDrawerProps {
  open: boolean;
  row: TicketLinkReviewRow | null;
  onClose: () => void;
  onApplied: () => void;
}

type OverrideType = "CONFIRMED_NO_TICKET" | "CORRECTED" | "DUPLICATE";

// Gate B - segundo comando de corrección conectado a UI
// (correction:ticket-link, POST /api/audit/corrections/ticket-link).
// Mismo patrón que PartAliasCorrectionDrawer: DetailDrawer canónico,
// Idempotency-Key generada una vez por apertura, nunca resuelve el issue de
// inmediato (la verificación ocurre después vía el outbox).
export function TicketLinkCorrectionDrawer({ open, row, onClose, onApplied }: TicketLinkCorrectionDrawerProps) {
  const [overrideType, setOverrideType] = useState<OverrideType>("CONFIRMED_NO_TICKET");
  const [correctedZendeskTicketId, setCorrectedZendeskTicketId] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [correctionVersionId, setCorrectionVersionId] = useState<number | null>(null);

  const idempotencyKey = useMemo(() => crypto.randomUUID(), [open, row?.fieldbeat_task_id]);

  useEffect(() => {
    if (!open) return;
    setOverrideType("CONFIRMED_NO_TICKET");
    setCorrectedZendeskTicketId("");
    setReason("");
    setError(null);
    setApplied(false);
    setCorrectionVersionId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.fieldbeat_task_id]);

  if (!row) return null;

  function handleClose() {
    onClose();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/audit/corrections/ticket-link", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({
          fieldbeatTaskId: row!.fieldbeat_task_id,
          overrideType,
          correctedZendeskTicketId: overrideType === "CONFIRMED_NO_TICKET" ? undefined : Number(correctedZendeskTicketId),
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
      title={`Vínculo de ticket - tarea ${row.fieldbeat_task_id}`}
      footerNote="La corrección se registra de inmediato; la incidencia permanece en revisión hasta que la regla confirme que ya no detecta el problema."
    >
      {applied ? (
        <div className="flex flex-col gap-3">
          <p style={{ color: "var(--nx-text-primary)" }}>
            Corrección registrada. Verificación en curso - la incidencia se resolverá automáticamente cuando la regla
            confirme que el vínculo de ticket ya no aparece como faltante o restringido.
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
              Ticket vinculado actualmente
            </div>
            <div style={{ color: "var(--nx-text-primary)" }}>{row.linked_zendesk_ticket_id ?? "(ninguno)"}</div>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
              Tipo de corrección
            </span>
            <select
              value={overrideType}
              onChange={event => setOverrideType(event.target.value as OverrideType)}
              className="rounded border px-2 py-1.5"
              style={{ borderColor: "var(--nx-border)" }}
            >
              <option value="CONFIRMED_NO_TICKET">Confirmar que esta visita nunca generó ticket</option>
              <option value="CORRECTED">Corregir al ticket correcto</option>
              <option value="DUPLICATE">Marcar como duplicado</option>
            </select>
          </label>

          {overrideType !== "CONFIRMED_NO_TICKET" && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
                ID de ticket Zendesk correcto
              </span>
              <input
                type="number"
                required
                value={correctedZendeskTicketId}
                onChange={event => setCorrectedZendeskTicketId(event.target.value)}
                className="rounded border px-2 py-1.5"
                style={{ borderColor: "var(--nx-border)" }}
              />
            </label>
          )}

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
