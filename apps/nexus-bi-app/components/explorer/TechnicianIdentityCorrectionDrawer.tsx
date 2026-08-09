"use client";

import { useEffect, useMemo, useState } from "react";
import { DetailDrawer } from "@/components/ui/DetailDrawer";
import { UndoCorrectionButton } from "@/components/audit/UndoCorrectionButton";

interface TechnicianIdentityCorrectionDrawerProps {
  open: boolean;
  normalizedName: string | null;
  currentDisplayName: string | null;
  onClose: () => void;
  onApplied: () => void;
}

type SourceType = "ASSIGNED_TO_USERNAME" | "SIGNATURE_NAME" | "ADDITIONAL_FIELD_TOKEN";

// Gate B - tercer comando de corrección conectado a UI
// (correction:technician-identity, POST /api/audit/corrections/technician-identity).
// A diferencia de alias/ticket-link, este comando NUNCA dispara una
// verificación posterior (no hay regla de calidad asociada a identidad de
// técnico) - el mensaje de éxito lo dice explícitamente, nunca promete una
// verificación que no va a ocurrir.
export function TechnicianIdentityCorrectionDrawer({
  open,
  normalizedName,
  currentDisplayName,
  onClose,
  onApplied
}: TechnicianIdentityCorrectionDrawerProps) {
  const [sourceType, setSourceType] = useState<SourceType>("ASSIGNED_TO_USERNAME");
  const [sourceValueNormalized, setSourceValueNormalized] = useState("");
  const [canonicalPersonKey, setCanonicalPersonKey] = useState("");
  const [canonicalDisplayName, setCanonicalDisplayName] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [correctionVersionId, setCorrectionVersionId] = useState<number | null>(null);

  const idempotencyKey = useMemo(() => crypto.randomUUID(), [open, normalizedName]);

  useEffect(() => {
    if (!open) return;
    setSourceType("ASSIGNED_TO_USERNAME");
    setSourceValueNormalized(normalizedName ?? "");
    setCanonicalPersonKey((normalizedName ?? "").toLowerCase().replace(/\s+/g, "."));
    setCanonicalDisplayName(currentDisplayName ?? normalizedName ?? "");
    setReason("");
    setError(null);
    setApplied(false);
    setCorrectionVersionId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, normalizedName]);

  if (!normalizedName) return null;

  function handleClose() {
    onClose();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/audit/corrections/technician-identity", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({
          sourceType,
          sourceValueNormalized,
          canonicalPersonKey,
          canonicalDisplayName,
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
    <DetailDrawer open={open} onClose={handleClose} title={`Resolver identidad - ${normalizedName}`}>
      {applied ? (
        <div className="flex flex-col gap-3">
          <p style={{ color: "var(--nx-text-primary)" }}>
            Identidad promovida a verificada manualmente. Este comando no dispara una verificación automática - no hay
            una regla de calidad asociada a identidad de técnico.
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
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
              Tipo de representación de origen
            </span>
            <select
              value={sourceType}
              onChange={event => setSourceType(event.target.value as SourceType)}
              className="rounded border px-2 py-1.5"
              style={{ borderColor: "var(--nx-border)" }}
            >
              <option value="ASSIGNED_TO_USERNAME">Nombre de usuario asignado</option>
              <option value="SIGNATURE_NAME">Nombre de firma</option>
              <option value="ADDITIONAL_FIELD_TOKEN">Token de campo adicional</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
              Valor de origen normalizado
            </span>
            <input
              type="text"
              required
              value={sourceValueNormalized}
              onChange={event => setSourceValueNormalized(event.target.value)}
              className="rounded border px-2 py-1.5"
              style={{ borderColor: "var(--nx-border)" }}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
              Clave canónica de persona
            </span>
            <input
              type="text"
              required
              value={canonicalPersonKey}
              onChange={event => setCanonicalPersonKey(event.target.value)}
              className="rounded border px-2 py-1.5"
              style={{ borderColor: "var(--nx-border)" }}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
              Nombre canónico para mostrar
            </span>
            <input
              type="text"
              required
              value={canonicalDisplayName}
              onChange={event => setCanonicalDisplayName(event.target.value)}
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
              {submitting ? "Aplicando…" : "Confirmar identidad"}
            </button>
          </div>
        </form>
      )}
    </DetailDrawer>
  );
}
