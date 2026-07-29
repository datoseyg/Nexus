"use client";

import { useEffect, useState } from "react";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { FilterBar } from "@/components/ui/FilterBar";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PartsReviewSection } from "./PartsReviewSection";
import { AmbiguousPartsSection } from "./AmbiguousPartsSection";
import { PlaceholdersSection } from "./PlaceholdersSection";
import { ReportsReviewSection } from "./ReportsReviewSection";
import { TicketLinksReviewSection } from "./TicketLinksReviewSection";
import { correctionTypeLabel, actorTypeLabel } from "@/lib/audit-vocabulary";

interface CorreccionesSectionProps {
  clientes: string[];
  maquinas: string[];
  role: "gerencia" | "administracion";
}

type SubTab = "aplicar-parts" | "aplicar-ambiguous" | "aplicar-placeholders" | "aplicar-reports" | "aplicar-tickets" | "historial";

const SUB_TABS: Array<{ key: SubTab; label: string }> = [
  { key: "aplicar-parts", label: "Repuestos por revisar" },
  { key: "aplicar-ambiguous", label: "Matches ambiguos" },
  { key: "aplicar-placeholders", label: "Placeholders" },
  { key: "aplicar-reports", label: "Reportes con revisión requerida" },
  { key: "aplicar-tickets", label: "Tickets faltantes o restringidos" },
  { key: "historial", label: "Historial de versiones" }
];

const CORRECTION_TYPE_OPTIONS = ["part-alias", "technician-identity", "ticket-link", "equipment-identification"];

interface CorrectionVersionRow {
  id: string;
  correction_type: string;
  target_type: string;
  target_key: Record<string, unknown>;
  payload: Record<string, unknown>;
  version: number;
  actor_type: string;
  actor_user_id: string | null;
  reason: string;
  created_at: string;
  superseded_by: string | null;
  reversal_of: string | null;
  is_effective: boolean;
}

// Claves de negocio conocidas de target_key/payload (governance.
// correction_versions, B5/B40) - target_key/payload son jsonb de forma
// distinta por correction_type (nunca una columna fija), así que no hay una
// sola tabla que los muestre con nombre de columna propio. Traduce las
// claves conocidas; una clave nueva se muestra en su forma original
// (nunca inventa una traducción) - señal de que este mapa quedó atrás de un
// tipo de corrección nuevo.
const OBJECT_KEY_LABELS: Record<string, string> = {
  aliasType: "Tipo de alias",
  aliasValue: "Valor de alias",
  dolibarrProductId: "Producto Dolibarr",
  fieldbeatTaskId: "Reporte",
  overrideType: "Tipo de vínculo",
  correctedZendeskTicketId: "Ticket corregido",
  sourceType: "Origen",
  sourceValueNormalized: "Valor de origen",
  canonicalPersonKey: "Persona canónica",
  canonicalDisplayName: "Nombre",
  verificationMethod: "Método de verificación",
  correctedEquipmentInternalId: "Equipo corregido",
  rawEquipmentReference: "Referencia cruda",
  reversedCorrectionVersionId: "Versión revertida",
  identityMapId: "Identidad #"
};

function formatCompactObject(value: Record<string, unknown> | null | undefined): string {
  if (!value || Object.keys(value).length === 0) return "-";
  return Object.entries(value)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([key, v]) => `${OBJECT_KEY_LABELS[key] ?? key}: ${String(v)}`)
    .join(", ");
}

// Agrupa preservando el orden de primera aparición (la página ya viene
// ordenada por fecha desde la API) - nunca reordena alfabéticamente, para
// que "más reciente primero" se mantenga dentro de cada grupo.
function groupCorrectionsByType(rows: CorrectionVersionRow[]): Array<[string, CorrectionVersionRow[]]> {
  const groups = new Map<string, CorrectionVersionRow[]>();
  for (const row of rows) {
    const list = groups.get(row.correction_type) ?? [];
    list.push(row);
    groups.set(row.correction_type, list);
  }
  return Array.from(groups.entries());
}

function correctionStatusBadge(row: CorrectionVersionRow): { label: string; tone: "success" | "warning" | "neutral" } {
  if (row.is_effective) return { label: "Vigente", tone: "success" };
  if (row.reversal_of) return { label: "Reversión", tone: "warning" };
  return { label: "Reemplazada", tone: "neutral" };
}

interface CorrectionVersionsResponse {
  rows: CorrectionVersionRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
}

function VersionsHistory() {
  const [correctionType, setCorrectionType] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CorrectionVersionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (correctionType) params.set("correctionType", correctionType);
    fetch(`/api/audit/corrections?${params.toString()}`)
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw body;
        setData(body);
      })
      .catch(body => setError(body?.error ?? "Error desconocido"))
      .finally(() => setLoading(false));
  }, [correctionType, page]);

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        quickAccess={
          <>
            {CORRECTION_TYPE_OPTIONS.map(option => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setCorrectionType(correctionType === option ? "" : option);
                  setPage(1);
                }}
                className="rounded-full border px-3 py-1 text-xs font-semibold"
                style={{
                  borderColor: correctionType === option ? "var(--nx-accent-indigo)" : "var(--nx-border)",
                  color: correctionType === option ? "var(--nx-accent-indigo)" : "var(--nx-text-secondary)"
                }}
              >
                {correctionTypeLabel(option)}
              </button>
            ))}
          </>
        }
      >
        <span className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
          Historial completo de versiones - efectiva/vigente marcada, revertidas visibles con su reversión.
        </span>
      </FilterBar>

      <ResponsiveTableShell
        title="Versiones de corrección"
        count={data?.totalRows}
        loading={loading}
        error={error}
        empty={!loading && !error && (data?.rows.length ?? 0) === 0}
        emptyMessage="Sin correcciones registradas para este filtro."
        maxHeight={480}
        footer={
          data && (
            <>
              <span>
                Página {data.page} de {data.totalPages}
              </span>
              <button type="button" onClick={() => setPage(p => p - 1)} disabled={page <= 1} className="rounded border px-2" style={{ borderColor: "var(--nx-border)" }}>
                ‹
              </button>
              <button
                type="button"
                onClick={() => setPage(p => p + 1)}
                disabled={page >= data.totalPages}
                className="rounded border px-2"
                style={{ borderColor: "var(--nx-border)" }}
              >
                ›
              </button>
            </>
          )
        }
      >
        {groupCorrectionsByType(data?.rows ?? []).map(([type, rows]) => (
          <div key={type} className="mb-4 last:mb-0">
            <div className="mb-1.5 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--nx-text-secondary)" }}>
              {correctionTypeLabel(type)}
            </div>

            <table className="hidden w-full text-sm md:table">
              <thead>
                <tr>
                  <th className="text-left">Objetivo</th>
                  <th className="text-left">Valor actual/corregido</th>
                  <th className="text-left">Versión</th>
                  <th className="text-left">Estado</th>
                  <th className="text-left">Actor</th>
                  <th className="text-left">Fecha</th>
                  <th className="text-left">Razón</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id}>
                    <td>{formatCompactObject(row.target_key)}</td>
                    <td>{formatCompactObject(row.payload)}</td>
                    <td>{row.version}</td>
                    <td>
                      <StatusBadge {...correctionStatusBadge(row)} size="sm" />
                    </td>
                    <td>{actorTypeLabel(row.actor_type)}</td>
                    <td>{new Date(row.created_at).toLocaleString("es-CL")}</td>
                    <td title={row.reason}>{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex flex-col gap-2 md:hidden">
              {rows.map(row => (
                <div key={row.id} className="flex flex-col gap-1.5 rounded-[var(--nx-radius-card)] border p-3 text-sm" style={{ borderColor: "var(--nx-border)" }}>
                  <div className="flex items-start justify-between gap-2">
                    <span style={{ color: "var(--nx-text-primary)" }}>{formatCompactObject(row.target_key)}</span>
                    <StatusBadge {...correctionStatusBadge(row)} size="sm" />
                  </div>
                  <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                    Valor: {formatCompactObject(row.payload)}
                  </div>
                  <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                    v{row.version} · {actorTypeLabel(row.actor_type)} · {new Date(row.created_at).toLocaleString("es-CL")}
                  </div>
                  <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                    {row.reason}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </ResponsiveTableShell>
    </div>
  );
}

// Gate B - Familia 8: pestaña "Correcciones" - agrupa los workbenches donde
// se APLICA cada corrección (con el contexto de negocio completo: cliente,
// equipo, reporte - ya conectados en Familias 1/2/5) junto con el historial
// de versiones (nuevo, solo lectura, governance.correction_versions). Nunca
// dos superficies separadas para "aplicar" vs. "ver el estado" de una
// corrección - viven en la misma pestaña, distinguidas por sub-navegación.
export function CorreccionesSection({ clientes, maquinas, role }: CorreccionesSectionProps) {
  const [subTab, setSubTab] = useState<SubTab>("aplicar-parts");

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Sub-secciones de Correcciones" className="-mx-1 flex gap-1 overflow-x-auto border-b px-1 pb-px" style={{ borderColor: "var(--nx-border)" }}>
        {SUB_TABS.map(tab => {
          const active = subTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`corrections-subtab-${tab.key}`}
              aria-selected={active}
              aria-controls={`corrections-subtabpanel-${tab.key}`}
              onClick={() => setSubTab(tab.key)}
              className="shrink-0 whitespace-nowrap rounded-t-lg px-3 py-1.5 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{
                color: active ? "var(--nx-accent-indigo)" : "var(--nx-text-secondary)",
                borderBottom: active ? "2px solid var(--nx-accent-indigo)" : "2px solid transparent",
                outlineColor: "var(--nx-focus-ring-color)"
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`corrections-subtabpanel-${subTab}`} aria-labelledby={`corrections-subtab-${subTab}`} tabIndex={0}>
        {subTab === "aplicar-parts" && <PartsReviewSection clientes={clientes} maquinas={maquinas} role={role} />}
        {subTab === "aplicar-ambiguous" && <AmbiguousPartsSection clientes={clientes} maquinas={maquinas} role={role} />}
        {subTab === "aplicar-placeholders" && <PlaceholdersSection clientes={clientes} maquinas={maquinas} />}
        {subTab === "aplicar-reports" && <ReportsReviewSection clientes={clientes} maquinas={maquinas} />}
        {subTab === "aplicar-tickets" && <TicketLinksReviewSection clientes={clientes} maquinas={maquinas} role={role} />}
        {subTab === "historial" && <VersionsHistory />}
      </div>
    </div>
  );
}
