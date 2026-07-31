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
 * drawer de corrección paralelo por pestaña.
 *
 * candidate_dolibarr_product_ids (opcional, solo AmbiguousPartsSection):
 * IDs ya sugeridos por el matching automático - se muestran como accesos
 * directos de búsqueda (nunca como una lista cruda a memorizar, sección 6
 * de la corrección de negocio "no obligar al usuario a interpretar una
 * lista concatenada de IDs"). */
export interface PartAliasCorrectionTarget {
  raw_part_identifier: string | null;
  fieldbeat_task_id?: number;
  candidate_dolibarr_product_ids?: string | null;
}

interface PartAliasCorrectionDrawerProps {
  open: boolean;
  row: PartAliasCorrectionTarget | null;
  onClose: () => void;
  onApplied: () => void;
}

type AliasType = "RAW" | "NORMALIZED";

interface ProductOption {
  dolibarr_product_id: number | string;
  ref: string;
  label: string | null;
}

// Selector de producto Dolibarr - búsqueda real por referencia/descripción
// (reutiliza GET /api/explorer/products, la misma consulta que ya usa el
// Explorador para "Productos de catálogo" - nunca un endpoint de búsqueda
// paralelo). El usuario nunca escribe ni copia un ID: busca por texto, ve
// el producto real (referencia + nombre) y pulsa "Seleccionar" - el ID
// interno viaja en el payload sin que el usuario lo vea o lo digite.
function ProductPicker({ candidateIds, onSelect }: { candidateIds: string[]; onSelect: (product: ProductOption) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      setSearchError(null);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    setSearchError(null);
    const timer = setTimeout(() => {
      fetch(`/api/explorer/products?q=${encodeURIComponent(query.trim())}&pageSize=8`, { signal: controller.signal })
        .then(async res => {
          const body = await res.json();
          if (!res.ok) throw body;
          setResults(body.rows ?? []);
        })
        .catch(error => {
          if (error?.name === "AbortError") return;
          setResults([]);
          setSearchError("No fue posible buscar productos - revisa tu conexión e inténtalo de nuevo.");
        })
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <div className="flex flex-col gap-2">
      {candidateIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
            Candidatos sugeridos por el sistema:
          </span>
          {candidateIds.map(id => (
            <button
              key={id}
              type="button"
              onClick={() => setQuery(id)}
              className="rounded-full border px-2.5 py-1 text-xs font-semibold"
              style={{ borderColor: "var(--nx-accent-indigo)", color: "var(--nx-accent-indigo)" }}
            >
              Ver #{id}
            </button>
          ))}
        </div>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
          Buscar producto (referencia o descripción)
        </span>
        <input
          type="text"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Ej. filtro, catéter, 45133..."
          className="rounded border px-2 py-1.5"
          style={{ borderColor: "var(--nx-border)" }}
        />
      </label>

      {searching && (
        <p className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
          Buscando…
        </p>
      )}
      {searchError && (
        <p className="text-xs" style={{ color: "var(--nx-danger, #c0392b)" }}>
          {searchError}
        </p>
      )}
      {!searching && !searchError && results !== null && results.length === 0 && (
        <p className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
          Sin productos que coincidan con &quot;{query}&quot;.
        </p>
      )}
      {results && results.length > 0 && (
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded border p-1.5" style={{ borderColor: "var(--nx-border)" }}>
          {results.map(product => (
            <li key={String(product.dolibarr_product_id)}>
              <button
                type="button"
                onClick={() => onSelect(product)}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--nx-page-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{ outlineColor: "var(--nx-focus-ring-color)" }}
              >
                <span className="min-w-0 truncate">
                  <span style={{ color: "var(--nx-text-primary)" }}>{product.label ?? "(sin descripción)"}</span>
                  <span className="ml-2 text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                    {product.ref}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-semibold" style={{ color: "var(--nx-accent-indigo)" }}>
                  Seleccionar
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
  // Default NORMALIZED ("También escrituras equivalentes"): el valor de este
  // drawer SIEMPRE es un identificador de repuesto (raw_part_identifier) -
  // normalizarlo (mayúsculas/espacios/puntuación) es seguro por defecto. El
  // usuario puede acotar a "Solo esta escritura exacta" (RAW) si de verdad lo
  // necesita.
  const [aliasType, setAliasType] = useState<AliasType>("NORMALIZED");
  const [aliasValue, setAliasValue] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<ProductOption | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [correctionVersionId, setCorrectionVersionId] = useState<number | null>(null);

  const idempotencyKey = useMemo(() => crypto.randomUUID(), [open, row?.raw_part_identifier]);
  const candidateIds = useMemo(
    () =>
      (row?.candidate_dolibarr_product_ids ?? "")
        .split(/[,;|]/)
        .map(id => id.trim())
        .filter(Boolean),
    [row?.candidate_dolibarr_product_ids]
  );

  // Se resetea cada vez que el drawer se ABRE para un row dado - nunca al
  // cerrar (evita depender de un setTimeout para que el usuario alcance a
  // ver el mensaje de éxito antes de que el formulario se limpie).
  useEffect(() => {
    if (!open) return;
    setAliasType("NORMALIZED");
    setAliasValue(row?.raw_part_identifier ?? "");
    setSelectedProduct(null);
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
    if (!selectedProduct) return;
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/audit/corrections/part-alias", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({
          aliasValue,
          aliasType,
          dolibarrProductId: Number(selectedProduct.dolibarr_product_id),
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

          {/* "Alcance de la corrección" - RAW/NORMALIZED son valores
              canónicos internos (governance.correction_versions.payload),
              NUNCA vocabulario de usuario: nunca se muestran esos nombres,
              el enum, "match key" ni el concepto de normalización técnica -
              solo lenguaje de negocio sobre QUÉ escrituras cubre la
              corrección. */}
          <fieldset className="flex flex-col gap-1.5 text-sm">
            <legend className="mb-0.5 font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
              Alcance de la corrección
            </legend>
            <label className="flex cursor-pointer items-start gap-2 rounded border px-2.5 py-2" style={{ borderColor: aliasType === "RAW" ? "var(--nx-accent-indigo)" : "var(--nx-border)" }}>
              <input type="radio" name="aliasType" className="mt-0.5" checked={aliasType === "RAW"} onChange={() => setAliasType("RAW")} />
              <span>
                <span className="block font-semibold" style={{ color: "var(--nx-text-primary)" }}>
                  Solo esta escritura exacta
                </span>
                <span className="block text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                  La corrección se aplicará únicamente cuando aparezca exactamente este valor.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded border px-2.5 py-2" style={{ borderColor: aliasType === "NORMALIZED" ? "var(--nx-accent-indigo)" : "var(--nx-border)" }}>
              <input type="radio" name="aliasType" className="mt-0.5" checked={aliasType === "NORMALIZED"} onChange={() => setAliasType("NORMALIZED")} />
              <span>
                <span className="block font-semibold" style={{ color: "var(--nx-text-primary)" }}>
                  También escrituras equivalentes
                </span>
                <span className="block text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                  La corrección también se aplicará a variantes de mayúsculas, espacios y signos de puntuación.
                </span>
                <span className="mt-1 block text-xs italic" style={{ color: "var(--nx-text-secondary)" }}>
                  Ej.: &quot;cx 1551-g&quot;, &quot;CX1551G&quot; y &quot;cx1551g&quot; se tratarán como el mismo identificador.
                </span>
              </span>
            </label>
          </fieldset>

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

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
              Producto correcto en el catálogo Dolibarr
            </span>
            {selectedProduct ? (
              <div className="flex items-center justify-between gap-2 rounded border px-3 py-2" style={{ borderColor: "var(--nx-accent-indigo)", background: "var(--nx-page-bg)" }}>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold" style={{ color: "var(--nx-text-primary)" }}>
                    {selectedProduct.label ?? "(sin descripción)"}
                  </div>
                  <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                    Referencia {selectedProduct.ref}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedProduct(null)}
                  className="shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold"
                  style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)" }}
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <ProductPicker candidateIds={candidateIds} onSelect={setSelectedProduct} />
            )}
          </div>

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
              disabled={submitting || !selectedProduct}
              title={!selectedProduct ? "Busca y selecciona el producto correcto antes de aplicar la corrección" : undefined}
              className="rounded-full px-3 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
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
