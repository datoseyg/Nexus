"use client";

import { useEffect, useMemo, useState } from "react";
import { DetailDrawer } from "@/components/ui/DetailDrawer";
import { StatusBadge, issueStatusBadge, severityBadge } from "@/components/ui/StatusBadge";

interface ReviewCaseCreateDrawerProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

interface CandidateIssue {
  id: string;
  rule_code: string;
  severity: string;
  status: string;
  entity_type: string;
  entity_key: string;
  active_review_case_id: string | null;
}

// Gate B - Familia 4: crea un caso de revisión a partir de 1+ incidencias
// SIN membresía activa (governance.fn_create_review_case exige razón, un
// issue solo puede estar en un caso activo a la vez - B53). Lista candidatos
// reales desde /api/audit/issues (OPEN/IN_REVIEW), nunca un selector
// inventado.
export function ReviewCaseCreateDrawer({ open, onClose, onCreated }: ReviewCaseCreateDrawerProps) {
  const idempotencyKey = useMemo(() => crypto.randomUUID(), [open]);
  const [candidates, setCandidates] = useState<CandidateIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ reviewCaseId: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setReason("");
    setError(null);
    setSuccess(null);
    setLoading(true);
    fetch("/api/audit/issues?status=OPEN&pageSize=50")
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw body;
        setCandidates((body.rows as CandidateIssue[]).filter(row => !row.active_review_case_id));
      })
      .catch(() => setCandidates([]))
      .finally(() => setLoading(false));
  }, [open]);

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (selected.size === 0) {
      setError("Selecciona al menos una incidencia.");
      return;
    }
    if (!reason.trim()) {
      setError("Se requiere una razón para este comando.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/audit/review-cases", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({ issueIds: Array.from(selected).map(Number), reason: reason.trim() })
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body?.error ?? "No se pudo crear el caso.");
        return;
      }
      setSuccess({ reviewCaseId: String(body.reviewCaseId) });
      onCreated();
    } catch {
      setError("Error de red - el caso no se creó.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DetailDrawer open={open} onClose={onClose} title="Nuevo caso de revisión">
      {success ? (
        <div className="flex flex-col gap-2">
          <p style={{ color: "var(--nx-text-primary)" }}>Caso #{success.reviewCaseId} creado.</p>
          <button
            type="button"
            onClick={onClose}
            className="self-start rounded-full px-3 py-1.5 text-sm font-semibold text-white"
            style={{ background: "var(--nx-accent, #4a55d4)" }}
          >
            Cerrar
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <div className="mb-1 text-xs font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
              Incidencias abiertas sin caso activo
            </div>
            {loading ? (
              <p style={{ color: "var(--nx-text-secondary)" }}>Cargando…</p>
            ) : candidates.length === 0 ? (
              <p style={{ color: "var(--nx-text-muted)" }}>No hay incidencias OPEN sin caso activo.</p>
            ) : (
              <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded border p-2" style={{ borderColor: "var(--nx-border)" }}>
                {candidates.map(issue => (
                  <label key={issue.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={selected.has(issue.id)} onChange={() => toggle(issue.id)} />
                    <span>{issue.rule_code}</span>
                    <StatusBadge {...severityBadge(issue.severity)} size="sm" />
                    <StatusBadge {...issueStatusBadge(issue.status)} size="sm" />
                    <span style={{ color: "var(--nx-text-secondary)" }}>
                      {issue.entity_type}:{issue.entity_key}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
              Razón (obligatoria)
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
              onClick={onClose}
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
              {submitting ? "Creando…" : "Crear caso"}
            </button>
          </div>
        </form>
      )}
    </DetailDrawer>
  );
}
