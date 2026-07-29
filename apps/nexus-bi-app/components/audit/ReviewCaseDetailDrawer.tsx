"use client";

import { useEffect, useMemo, useState } from "react";
import { DetailDrawer } from "@/components/ui/DetailDrawer";
import { StatusBadge, issueStatusBadge, reviewCaseStatusBadge, severityBadge } from "@/components/ui/StatusBadge";
import { RestrictedReadReveal } from "./RestrictedReadReveal";
import { entityTypeLabel, membershipEndReasonLabel } from "@/lib/audit-vocabulary";

interface ReviewCaseDetailDrawerProps {
  reviewCaseId: string | null;
  role: "gerencia" | "administracion";
  onClose: () => void;
  onChanged: () => void;
}

interface CaseDetail {
  case: { id: string; status: string; assigned_to: string | null; opened_at: string; closed_at: string | null; version: number };
  activeIssues: Array<{ membership_id: string; issue_id: string; rule_code: string; rule_title: string; severity: string; issue_status: string; entity_type: string; entity_key: string }>;
  endedIssues: Array<{ membership_id: string; issue_id: string; rule_code: string; rule_title: string; membership_end_reason: string; membership_ended_at: string }>;
  comments: Array<{ id: string; actor_user_id: string; body: string | null; is_redacted: boolean; supersedes_comment_id: string | null; created_at: string }>;
}

const FINAL_STATUSES = [
  { value: "RESOLVED", label: "Resuelto" },
  { value: "DISMISSED", label: "Descartado" }
];

// Gate B - Familia 4: drawer canónico de detalle de un caso de revisión -
// membresías activas/históricas, comentarios (inmutables, "editar" = nuevo
// comentario con supersedesCommentId), asignar/reasignar, agregar/terminar
// membresía de un issue, cerrar (cascada de membresías, B53)/reabrir.
// Administración ve las acciones; Gerencia ve la misma información en modo
// exclusivamente lectura (nunca botones deshabilitados sin explicación).
export function ReviewCaseDetailDrawer({ reviewCaseId, role, onClose, onChanged }: ReviewCaseDetailDrawerProps) {
  const open = reviewCaseId !== null;
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newIssueId, setNewIssueId] = useState("");
  const [newIssueReason, setNewIssueReason] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [closeFinalStatus, setCloseFinalStatus] = useState("RESOLVED");
  const [closeReason, setCloseReason] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [showClose, setShowClose] = useState(false);
  const [showReopen, setShowReopen] = useState(false);
  const [endMembershipTarget, setEndMembershipTarget] = useState<string | null>(null);
  const [endMembershipReason, setEndMembershipReason] = useState("");
  const [redactTarget, setRedactTarget] = useState<string | null>(null);
  const [redactReason, setRedactReason] = useState("");

  const idemBase = useMemo(() => crypto.randomUUID(), [open, reviewCaseId]);

  function refetchDetail() {
    if (!reviewCaseId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/audit/review-cases/${reviewCaseId}`)
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw body;
        setDetail(body);
      })
      .catch(body => setError(body?.error ?? "Error desconocido"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!open) return;
    setDetail(null);
    setActionError(null);
    setNewIssueId("");
    setNewIssueReason("");
    setCommentBody("");
    setCloseReason("");
    setReopenReason("");
    setShowClose(false);
    setShowReopen(false);
    setEndMembershipTarget(null);
    setEndMembershipReason("");
    setRedactTarget(null);
    setRedactReason("");
    refetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reviewCaseId]);

  async function runAction(path: string, body: Record<string, unknown>, suffix: string): Promise<boolean> {
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `${idemBase}-${suffix}-${Date.now()}` },
        body: JSON.stringify(body)
      });
      const responseBody = await response.json();
      if (!response.ok) {
        setActionError(responseBody?.error ?? "No se pudo aplicar la acción.");
        return false;
      }
      refetchDetail();
      onChanged();
      return true;
    } catch {
      setActionError("Error de red - la acción no se envió.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const canAct = role === "administracion";
  const isClosed = detail?.case.status === "RESOLVED" || detail?.case.status === "DISMISSED";

  return (
    <DetailDrawer open={open} onClose={onClose} title={reviewCaseId ? `Caso #${reviewCaseId}` : "Caso"}>
      {loading && <p style={{ color: "var(--nx-text-secondary)" }}>Cargando…</p>}
      {error && <p style={{ color: "var(--nx-danger, #c0392b)" }}>{error}</p>}

      {!loading && !error && detail && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <StatusBadge {...reviewCaseStatusBadge(detail.case.status)} />
            <span className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
              Abierto {new Date(detail.case.opened_at).toLocaleString("es-CL")}
            </span>
            {detail.case.assigned_to && (
              <span className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                Asignado
              </span>
            )}
          </div>

          {actionError && (
            <div className="rounded border px-2 py-1.5 text-sm" style={{ borderColor: "var(--nx-danger, #c0392b)", color: "var(--nx-danger, #c0392b)" }}>
              {actionError}
            </div>
          )}

          {canAct && !isClosed && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => runAction(`/api/audit/review-cases/${reviewCaseId}/assign`, { expectedVersion: detail.case.version }, "assign")}
                className="rounded-full border px-3 py-1.5 text-xs font-semibold"
                style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-primary)" }}
              >
                Asignarme
              </button>
              <button
                type="button"
                onClick={() => setShowClose(v => !v)}
                className="rounded-full border px-3 py-1.5 text-xs font-semibold"
                style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-primary)" }}
              >
                Cerrar caso
              </button>
            </div>
          )}

          {canAct && isClosed && !showReopen && (
            <button
              type="button"
              onClick={() => setShowReopen(true)}
              className="self-start rounded-full border px-3 py-1.5 text-xs font-semibold"
              style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-primary)" }}
            >
              Reabrir caso
            </button>
          )}

          {canAct && showReopen && (
            <div className="flex flex-col gap-2 rounded border p-2" style={{ borderColor: "var(--nx-border)" }}>
              <textarea
                rows={2}
                value={reopenReason}
                onChange={event => setReopenReason(event.target.value)}
                placeholder="Razón (obligatoria)"
                className="rounded border px-2 py-1.5 text-sm"
                style={{ borderColor: "var(--nx-border)" }}
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowReopen(false)} className="rounded-full border px-3 py-1 text-xs" style={{ borderColor: "var(--nx-border)" }}>
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={busy || !reopenReason.trim()}
                  onClick={async () => {
                    const ok = await runAction(`/api/audit/review-cases/${reviewCaseId}/reopen`, { reason: reopenReason.trim(), expectedVersion: detail.case.version }, "reopen");
                    if (ok) setShowReopen(false);
                  }}
                  className="rounded-full px-3 py-1 text-xs font-semibold text-white"
                  style={{ background: "var(--nx-accent, #4a55d4)" }}
                >
                  Confirmar reapertura
                </button>
              </div>
            </div>
          )}

          {canAct && showClose && (
            <div className="flex flex-col gap-2 rounded border p-2" style={{ borderColor: "var(--nx-border)" }}>
              <select
                value={closeFinalStatus}
                onChange={event => setCloseFinalStatus(event.target.value)}
                className="rounded border px-2 py-1 text-sm"
                style={{ borderColor: "var(--nx-border)" }}
              >
                {FINAL_STATUSES.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <textarea
                rows={2}
                value={closeReason}
                onChange={event => setCloseReason(event.target.value)}
                placeholder="Razón (obligatoria)"
                className="rounded border px-2 py-1.5 text-sm"
                style={{ borderColor: "var(--nx-border)" }}
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowClose(false)} className="rounded-full border px-3 py-1 text-xs" style={{ borderColor: "var(--nx-border)" }}>
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={busy || !closeReason.trim()}
                  onClick={async () => {
                    const ok = await runAction(
                      `/api/audit/review-cases/${reviewCaseId}/close`,
                      { finalStatus: closeFinalStatus, reason: closeReason.trim(), expectedVersion: detail.case.version },
                      "close"
                    );
                    if (ok) setShowClose(false);
                  }}
                  className="rounded-full px-3 py-1 text-xs font-semibold text-white"
                  style={{ background: "var(--nx-accent, #4a55d4)" }}
                >
                  Confirmar cierre
                </button>
              </div>
            </div>
          )}

          <div>
            <div className="mb-1 text-xs font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
              Incidencias activas ({detail.activeIssues.length})
            </div>
            {detail.activeIssues.length === 0 ? (
              <p style={{ color: "var(--nx-text-muted)" }}>Sin incidencias activas en este caso.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {detail.activeIssues.map(issue => (
                  <li key={issue.membership_id} className="rounded border px-2 py-1 text-sm" style={{ borderColor: "var(--nx-border)" }}>
                    <div className="flex items-center justify-between gap-2">
                      <span>
                        {issue.rule_title} - {entityTypeLabel(issue.entity_type)}: {issue.entity_key}
                      </span>
                      <span className="flex items-center gap-1">
                        <StatusBadge {...severityBadge(issue.severity)} size="sm" />
                        <StatusBadge {...issueStatusBadge(issue.issue_status)} size="sm" />
                        {canAct && !isClosed && endMembershipTarget !== issue.issue_id && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setEndMembershipTarget(issue.issue_id);
                              setEndMembershipReason("");
                            }}
                            className="rounded-full border px-2 py-0.5 text-xs font-semibold"
                            style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-primary)" }}
                          >
                            Quitar
                          </button>
                        )}
                      </span>
                    </div>
                    {endMembershipTarget === issue.issue_id && (
                      <div className="mt-1.5 flex flex-col gap-1.5">
                        <input
                          type="text"
                          value={endMembershipReason}
                          onChange={event => setEndMembershipReason(event.target.value)}
                          placeholder="Razón para quitar esta incidencia del caso (obligatoria)"
                          className="rounded border px-2 py-1 text-xs"
                          style={{ borderColor: "var(--nx-border)" }}
                        />
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setEndMembershipTarget(null)} className="rounded-full border px-2 py-0.5 text-xs" style={{ borderColor: "var(--nx-border)" }}>
                            Cancelar
                          </button>
                          <button
                            type="button"
                            disabled={busy || !endMembershipReason.trim()}
                            onClick={async () => {
                              const ok = await runAction(
                                `/api/audit/review-cases/${reviewCaseId}/end-membership`,
                                { issueId: Number(issue.issue_id), reason: endMembershipReason.trim(), expectedVersion: detail.case.version },
                                "end-membership"
                              );
                              if (ok) setEndMembershipTarget(null);
                            }}
                            className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                            style={{ background: "var(--nx-accent, #4a55d4)" }}
                          >
                            Confirmar
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {canAct && !isClosed && (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-xs">
                  <span style={{ color: "var(--nx-text-secondary)" }}>ID de incidencia</span>
                  <input
                    type="number"
                    value={newIssueId}
                    onChange={event => setNewIssueId(event.target.value)}
                    className="w-28 rounded border px-2 py-1"
                    style={{ borderColor: "var(--nx-border)" }}
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1 text-xs">
                  <span style={{ color: "var(--nx-text-secondary)" }}>Razón</span>
                  <input
                    type="text"
                    value={newIssueReason}
                    onChange={event => setNewIssueReason(event.target.value)}
                    className="rounded border px-2 py-1"
                    style={{ borderColor: "var(--nx-border)" }}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || !newIssueId.trim() || !newIssueReason.trim()}
                  onClick={async () => {
                    const ok = await runAction(
                      `/api/audit/review-cases/${reviewCaseId}/add-issue`,
                      { issueId: Number(newIssueId), reason: newIssueReason.trim(), expectedVersion: detail.case.version },
                      "add-issue"
                    );
                    if (ok) {
                      setNewIssueId("");
                      setNewIssueReason("");
                    }
                  }}
                  className="rounded-full px-3 py-1.5 text-xs font-semibold text-white"
                  style={{ background: "var(--nx-accent, #4a55d4)" }}
                >
                  Agregar
                </button>
              </div>
            )}
          </div>

          {detail.endedIssues.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
                Historial de membresías
              </div>
              <ul className="flex flex-col gap-1 text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                {detail.endedIssues.map(issue => (
                  <li key={issue.membership_id}>
                    {issue.rule_title} - terminada ({membershipEndReasonLabel(issue.membership_end_reason)}) el {new Date(issue.membership_ended_at).toLocaleString("es-CL")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="mb-1 text-xs font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
              Comentarios ({detail.comments.length})
            </div>
            {detail.comments.length === 0 ? (
              <p style={{ color: "var(--nx-text-muted)" }}>Sin comentarios.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {detail.comments.map(comment => (
                  <li key={comment.id} className="rounded border px-2 py-1.5 text-sm" style={{ borderColor: "var(--nx-border)" }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                        {new Date(comment.created_at).toLocaleString("es-CL")}
                        {comment.supersedes_comment_id && ` - reemplaza al comentario #${comment.supersedes_comment_id}`}
                      </span>
                      {canAct && !comment.is_redacted && redactTarget !== comment.id && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setRedactTarget(comment.id);
                            setRedactReason("");
                          }}
                          className="rounded-full border px-2 py-0.5 text-xs font-semibold"
                          style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-primary)" }}
                        >
                          Redactar
                        </button>
                      )}
                    </div>
                    <p style={{ color: comment.is_redacted ? "var(--nx-text-muted)" : "var(--nx-text-primary)" }}>
                      {comment.is_redacted ? "[Contenido redactado]" : comment.body}
                    </p>
                    {comment.is_redacted && canAct && (
                      <RestrictedReadReveal kind="comment-original" objectId={Number(comment.id)} label="Ver original (acceso restringido)" />
                    )}
                    {redactTarget === comment.id && (
                      <div className="mt-1.5 flex flex-col gap-1.5">
                        <input
                          type="text"
                          value={redactReason}
                          onChange={event => setRedactReason(event.target.value)}
                          placeholder="Razón de redacción (obligatoria)"
                          className="rounded border px-2 py-1 text-xs"
                          style={{ borderColor: "var(--nx-border)" }}
                        />
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setRedactTarget(null)} className="rounded-full border px-2 py-0.5 text-xs" style={{ borderColor: "var(--nx-border)" }}>
                            Cancelar
                          </button>
                          <button
                            type="button"
                            disabled={busy || !redactReason.trim()}
                            onClick={async () => {
                              const ok = await runAction(`/api/audit/review-cases/comments/${comment.id}/redact`, { redactionReason: redactReason.trim() }, "redact");
                              if (ok) setRedactTarget(null);
                            }}
                            className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                            style={{ background: "var(--nx-accent, #4a55d4)" }}
                          >
                            Confirmar
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {canAct && (
              <div className="mt-2 flex flex-col gap-2">
                <textarea
                  rows={2}
                  value={commentBody}
                  onChange={event => setCommentBody(event.target.value)}
                  placeholder="Agregar comentario…"
                  className="rounded border px-2 py-1.5 text-sm"
                  style={{ borderColor: "var(--nx-border)" }}
                />
                <button
                  type="button"
                  disabled={busy || !commentBody.trim()}
                  onClick={async () => {
                    const ok = await runAction(`/api/audit/review-cases/${reviewCaseId}/comment`, { body: commentBody.trim() }, "comment");
                    if (ok) setCommentBody("");
                  }}
                  className="self-start rounded-full px-3 py-1.5 text-xs font-semibold text-white"
                  style={{ background: "var(--nx-accent, #4a55d4)" }}
                >
                  Comentar
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </DetailDrawer>
  );
}
