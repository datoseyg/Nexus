"use client";

import { useState } from "react";

interface IssueLifecycleActionsProps {
  issue: Record<string, unknown>;
  onChanged: () => void;
}

type ActiveAction = "start-review" | "dismiss" | "reopen" | null;

const ACTION_ROUTES: Record<Exclude<ActiveAction, null>, string> = {
  "start-review": "/api/audit/issues/start-review",
  dismiss: "/api/audit/issues/dismiss",
  reopen: "/api/audit/issues/reopen"
};

const ACTION_LABELS: Record<Exclude<ActiveAction, null>, string> = {
  "start-review": "Iniciar revisión",
  dismiss: "Descartar incidencia",
  reopen: "Reabrir incidencia"
};

// Gate B - ciclo de vida de incidencias (Familia 3): acciones inline dentro
// del detalle de Incidencias del Explorador. Las acciones disponibles
// dependen del status actual (nunca se ofrece "descartar" sobre algo ya
// descartado, ni "reabrir" sobre algo abierto) - la razón es obligatoria
// para descartar/reabrir, opcional para iniciar revisión.
export function IssueLifecycleActions({ issue, onChanged }: IssueLifecycleActionsProps) {
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = String(issue.status ?? "");
  const issueId = Number(issue.id);
  const version = Number(issue.version ?? 0);

  const availableActions: Exclude<ActiveAction, null>[] = [];
  if (status === "OPEN") {
    availableActions.push("start-review", "dismiss");
  } else if (status === "IN_REVIEW") {
    availableActions.push("dismiss");
  } else if (status === "RESOLVED" || status === "DISMISSED") {
    availableActions.push("reopen");
  }

  if (availableActions.length === 0) return null;

  function openAction(action: Exclude<ActiveAction, null>) {
    setActiveAction(action);
    setReason("");
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!activeAction) return;

    if (activeAction !== "start-review" && !reason.trim()) {
      setError("Se requiere una razón para este comando.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(ACTION_ROUTES[activeAction], {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ issueId, reason: reason.trim() || undefined, expectedVersion: version })
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body?.error ?? "No se pudo aplicar la acción.");
        return;
      }
      setActiveAction(null);
      onChanged();
    } catch {
      setError("Error de red - la acción no se envió.");
    } finally {
      setSubmitting(false);
    }
  }

  if (activeAction) {
    return (
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded border p-3" style={{ borderColor: "var(--nx-border)" }}>
        <div className="text-sm font-semibold" style={{ color: "var(--nx-text-primary)" }}>
          {ACTION_LABELS[activeAction]}
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
            Razón {activeAction === "start-review" ? "(opcional)" : "(obligatoria)"}
          </span>
          <textarea
            rows={2}
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
            onClick={() => setActiveAction(null)}
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
            {submitting ? "Aplicando…" : "Confirmar"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex gap-2">
      {availableActions.map(action => (
        <button
          key={action}
          type="button"
          onClick={() => openAction(action)}
          className="rounded-full px-3 py-1.5 text-sm font-semibold text-white"
          style={{ background: "var(--nx-accent, #4a55d4)" }}
        >
          {ACTION_LABELS[action]}
        </button>
      ))}
    </div>
  );
}
