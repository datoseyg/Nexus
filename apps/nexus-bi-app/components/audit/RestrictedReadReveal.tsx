"use client";

import { useState } from "react";

type RestrictedReadKind = "evidence" | "comment-original" | "event-state";

interface RestrictedReadRevealProps {
  kind: RestrictedReadKind;
  /** ID del objeto exacto a leer (evidenceId/commentId/commandEventId según `kind`) -
   * un solo objeto por request, nunca una lista (B72). */
  objectId: number;
  label: string;
}

const ENDPOINT_AND_KEY: Record<RestrictedReadKind, { path: string; idKey: string }> = {
  evidence: { path: "/api/audit/restricted/evidence", idKey: "evidenceId" },
  "comment-original": { path: "/api/audit/restricted/comment-original", idKey: "commentId" },
  "event-state": { path: "/api/audit/restricted/event-state", idKey: "commandEventId" }
};

// Gate B - Familia 6: revela contenido restringido bajo demanda
// (audit:evidence-restricted, solo administracion) - razón obligatoria, un
// objeto por request, cada revelación queda auditada por la propia función
// SQL (RESTRICTED_EVIDENCE_ACCESSED/REDACTED_COMMENT_ACCESSED/
// RESTRICTED_EVENT_STATE_ACCESSED). Inline, nunca un drawer apilado, nunca
// window.prompt - misma familia de patrón que UndoCorrectionButton.
export function RestrictedReadReveal({ kind, objectId, label }: RestrictedReadRevealProps) {
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<unknown>(undefined);

  if (revealed !== undefined) {
    return (
      <div className="mt-1 flex flex-col gap-1 rounded border p-2" style={{ borderColor: "var(--nx-border)" }}>
        <span className="text-[11px] font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
          Contenido restringido revelado - este acceso quedó registrado en el historial de auditoría.
        </span>
        <pre className="whitespace-pre-wrap break-words text-[12px]" style={{ color: "var(--nx-text-primary)" }}>
          {typeof revealed === "string" ? revealed : JSON.stringify(revealed, null, 2)}
        </pre>
      </div>
    );
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="rounded-full border px-2.5 py-0.5 text-[11px] font-semibold"
        style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-primary)" }}
      >
        {label}
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
      const { path, idKey } = ENDPOINT_AND_KEY[kind];
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [idKey]: objectId, reason: reason.trim() })
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body?.error ?? "No se pudo revelar el contenido restringido.");
        return;
      }
      setRevealed(kind === "comment-original" ? body.body : body);
    } catch {
      setError("Error de red - la solicitud no se envió.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-1 flex flex-col gap-1.5 rounded border p-2" style={{ borderColor: "var(--nx-border)" }}>
      <span className="text-[11px] font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
        Razón de acceso (obligatoria) - este acceso queda registrado
      </span>
      <input
        type="text"
        value={reason}
        onChange={event => setReason(event.target.value)}
        className="rounded border px-2 py-1 text-[12px]"
        style={{ borderColor: "var(--nx-border)" }}
      />
      {error && (
        <div className="rounded border px-2 py-1 text-[11px]" style={{ borderColor: "var(--nx-danger, #c0392b)", color: "var(--nx-danger, #c0392b)" }}>
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setExpanded(false)} className="rounded-full border px-2 py-0.5 text-[11px]" style={{ borderColor: "var(--nx-border)" }}>
          Cancelar
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={handleConfirm}
          className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
          style={{ background: "var(--nx-accent, #4a55d4)" }}
        >
          {submitting ? "Revelando…" : "Confirmar acceso"}
        </button>
      </div>
    </div>
  );
}
