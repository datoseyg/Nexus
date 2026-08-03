"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DetailDrawer } from "@/components/ui/DetailDrawer";
import { IssueLifecycleActions } from "./IssueLifecycleActions";
import { ContractCoverageScheduleView } from "@/components/contracts/ContractCoverageScheduleView";
import { EXPLORER_ENTITY_CONFIG, formatCell } from "@/lib/explorer-entity-config";
import { hasCapability } from "@/lib/auth/capabilities-shared";
import type { ExplorerDetailResponse, ExplorerEntity } from "@/types/explorer";
import type { ContractScheduleResult } from "@/types/contracts";

interface ExplorerDetailDrawerProps {
  entity: ExplorerEntity | null;
  entityKey: string | null;
  role: "gerencia" | "administracion";
  capabilities: string[];
  onClose: () => void;
  /** Se llama tras cualquier acción que cambie datos (identidad de técnico,
   * ciclo de vida de incidencia) - el caller decide si eso implica refrescar
   * el listado exterior. */
  onChanged?: () => void;
  /** Navega al detalle canónico de OTRA entidad ("Ver equipo"/"Ver cliente"),
   * reemplazando el contenido de este mismo drawer vía la URL del Explorador
   * (ExplorerShell.navigateToDetail) - nunca apila un segundo drawer. */
  onNavigate?: (entity: ExplorerEntity, key: string) => void;
  /** Acción de corrección específica de una entidad (hoy solo "Resolver
   * identidad" para Técnicos, gateada a correction:technician-identity por
   * el caller) - recibe el summary ya cargado, nunca inventa una acción
   * genérica para las demás entidades. */
  resolveIdentityAction?: (summary: Record<string, unknown>) => void;
}

// Drawer de detalle GENÉRICO del Explorador (reutiliza DetailDrawer, nunca un
// modal paralelo) - configurado por entidad vía lib/explorer-entity-config.ts.
// Reportes usa su propio drawer canónico (FieldbeatReportDetailDrawer,
// montado aparte en ExplorerShell) - este componente nunca se abre para esa
// entidad (B22: nunca un segundo detalle de reporte).
export function ExplorerDetailDrawer({ entity, entityKey, capabilities, onClose, onChanged, onNavigate, resolveIdentityAction }: ExplorerDetailDrawerProps) {
  const open = entity !== null && entityKey !== null;
  const [data, setData] = useState<ExplorerDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refetchDetail() {
    if (!entity || !entityKey) return;
    setLoading(true);
    setError(null);
    fetch(`/api/explorer/detail?entity=${encodeURIComponent(entity)}&key=${encodeURIComponent(entityKey)}`)
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw body;
        setData(body);
      })
      .catch(body => setError(body?.error ?? "Error desconocido"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!open || !entity || !entityKey) return;
    setData(null);
    refetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entity, entityKey]);

  function handleIssueChanged() {
    refetchDetail();
    onChanged?.();
  }

  const config = entity ? EXPLORER_ENTITY_CONFIG[entity] : null;
  const summary = (data?.summary ?? {}) as Record<string, unknown>;

  return (
    <DetailDrawer open={open} onClose={onClose} title={config ? `${config.singularLabel}` : "Detalle"}>
      {loading && <p style={{ color: "var(--nx-text-secondary)" }}>Cargando…</p>}
      {error && (
        <p style={{ color: "var(--nx-danger, #c0392b)" }}>{error}</p>
      )}
      {!loading && !error && data && config && (
        <div className="flex flex-col gap-4">
          {data.identity.resolutionStatus !== "DIRECT" && (
            <div className="rounded border px-2 py-1.5 text-xs" style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)" }}>
              {data.identity.resolutionNote}
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {config.detailFields
              .filter(field => !field.technical)
              .map(field => (
                <div key={field.key}>
                  <dt className="text-xs font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
                    {field.header}
                  </dt>
                  <dd style={{ color: "var(--nx-text-primary)" }}>{formatCell(field, summary)}</dd>
                </div>
              ))}
          </dl>

          {config.detailFields.some(field => field.technical) && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold" style={{ color: "var(--nx-accent-indigo)" }}>
                Detalles técnicos
              </summary>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {config.detailFields
                  .filter(field => field.technical)
                  .map(field => (
                    <div key={field.key}>
                      <dt className="text-xs font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
                        {field.header}
                      </dt>
                      <dd style={{ color: "var(--nx-text-primary)" }}>{formatCell(field, summary)}</dd>
                    </div>
                  ))}
              </dl>
            </details>
          )}

          {resolveIdentityAction && (
            <div>
              <button
                type="button"
                onClick={() => resolveIdentityAction(summary)}
                className="rounded-full px-3 py-1.5 text-sm font-semibold text-white"
                style={{ background: "var(--nx-accent, #4a55d4)" }}
              >
                {summary.is_manually_verified ? "Revisar identidad" : "Resolver identidad"}
              </button>
            </div>
          )}

          {entity === "contracts" && summary.schedule != null && (
            <ContractCoverageScheduleView result={summary.schedule as ContractScheduleResult} />
          )}

          {entity === "issues" && typeof summary.entity_key === "string" && (
            <Link
              href={`/audit/manual-review?tab=inbox&q=${encodeURIComponent(summary.entity_key)}`}
              className="self-start text-sm font-semibold"
              style={{ color: "var(--nx-accent-indigo)" }}
            >
              Abrir en Bandeja de Auditoría →
            </Link>
          )}

          {entity === "equipment" && typeof summary.client_key === "string" && onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate("clients", summary.client_key as string)}
              className="self-start text-sm font-semibold"
              style={{ color: "var(--nx-accent-indigo)" }}
            >
              Ver cliente →
            </button>
          )}

          {entity === "contracts" && typeof summary.linked_equipment_key === "string" && onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate("equipment", summary.linked_equipment_key as string)}
              className="self-start text-sm font-semibold"
              style={{ color: "var(--nx-accent-indigo)" }}
            >
              Ver equipo →
            </button>
          )}

          {entity === "issues" && hasCapability(capabilities, "audit:review") && (
            <IssueLifecycleActions issue={summary} onChanged={handleIssueChanged} />
          )}

          {config.relatedSections.map(section => {
            const rows = (data.related[section.key] ?? []) as Record<string, unknown>[];
            if (rows.length === 0) return null;
            const viewAllCount = section.viewAllLink ? Number(summary[section.viewAllLink.countField] ?? rows.length) : null;
            return (
              <div key={section.key}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
                    {section.label}
                  </span>
                  {section.viewAllLink && viewAllCount !== null && (
                    <Link
                      href={`/explorer?entity=${section.viewAllLink.entity}&${new URLSearchParams(section.viewAllLink.buildFilters(summary)).toString()}`}
                      className="text-xs font-semibold"
                      style={{ color: "var(--nx-accent-indigo)" }}
                    >
                      Ver {viewAllCount === 1 ? "el" : `los ${viewAllCount}`} {EXPLORER_ENTITY_CONFIG[section.viewAllLink.entity].label.toLowerCase()} de este {config.singularLabel.toLowerCase()} →
                    </Link>
                  )}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      {section.columns.map(col => (
                        <th key={col.key} className="text-left" style={{ color: "var(--nx-text-secondary)" }}>
                          {col.header}
                        </th>
                      ))}
                      {section.rowLink && <th className="text-left" style={{ color: "var(--nx-text-secondary)" }} />}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => (
                      <tr key={idx}>
                        {section.columns.map(col => (
                          <td key={col.key} style={{ color: "var(--nx-text-primary)" }}>
                            {formatCell(col, row)}
                          </td>
                        ))}
                        {section.rowLink && (
                          <td>
                            {onNavigate && typeof row[section.rowLink.keyField] === "string" && (
                              <button
                                type="button"
                                onClick={() => onNavigate(section.rowLink!.entity, row[section.rowLink!.keyField] as string)}
                                className="whitespace-nowrap text-xs font-semibold"
                                style={{ color: "var(--nx-accent-indigo)" }}
                              >
                                {section.rowLink.label ?? "Ver →"}
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </DetailDrawer>
  );
}
