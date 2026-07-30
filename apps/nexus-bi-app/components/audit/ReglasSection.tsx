"use client";

import { useEffect, useState } from "react";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { StatusBadge, severityBadge } from "@/components/ui/StatusBadge";
import { entityTypeLabel } from "@/lib/audit-vocabulary";

interface RuleRow {
  rule_code: string;
  active_rule_version: number;
  is_active: boolean;
  entity_type: string;
  title: string;
  description: string;
  default_severity: string;
  rule_defined_at: string;
  retired_at: string | null;
  open_issue_count: string;
  last_evaluated_at: string | null;
}

// Gate B - Familia 8: pestaña "Reglas" - catálogo de reglas, solo lectura.
// NUNCA un editor SQL de reglas (Gate A, exclusión explícita) - cambiar una
// regla exige una nueva migración versionada, no un formulario acá.
// title (governance.rule_definitions.title) es el nombre de negocio y
// siempre lidera; rule_code se conserva visible pero secundario/mudo (nunca
// oculto del todo - "trazabilidad", docs/design-context/09) para quien
// necesite correlacionar con logs/SQL.
export function ReglasSection() {
  const [rows, setRows] = useState<RuleRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch("/api/audit/rules")
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw body;
        setRows(body.rows);
      })
      .catch(body => setError(body?.error ?? "Error desconocido"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ResponsiveTableShell
      title="Catálogo de reglas"
      count={rows?.length}
      loading={loading}
      error={error}
      empty={!loading && !error && (rows?.length ?? 0) === 0}
      emptyMessage="Sin reglas registradas."
    >
      {/* 4 columnas (no 7) para caber sin scroll horizontal a 1366px -
          severidad/universo afectado se agrupan como badges bajo una sola
          columna, y estado/última evaluación/incidencias abiertas se
          combinan bajo "Estado". La descripción envuelve en varias líneas
          en vez de truncar con elipsis (sección 10: "no truncar la
          descripción si hay espacio vertical disponible"). */}
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr>
            <th className="text-left">Regla</th>
            <th className="text-left">Descripción</th>
            <th className="text-left">Alcance</th>
            <th className="text-left">Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows?.map(row => (
            <tr key={row.rule_code}>
              <td style={{ whiteSpace: "normal", maxWidth: 220 }}>
                <div style={{ color: "var(--nx-text-primary)" }}>{row.title}</div>
                <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                  {row.rule_code} · v{row.active_rule_version}
                </div>
              </td>
              <td style={{ whiteSpace: "normal", maxWidth: 420 }}>{row.description}</td>
              <td>
                <div className="flex flex-col gap-1">
                  <StatusBadge {...severityBadge(row.default_severity)} size="sm" />
                  <StatusBadge label={entityTypeLabel(row.entity_type)} tone="neutral" size="sm" />
                </div>
              </td>
              <td style={{ whiteSpace: "normal" }}>
                <StatusBadge label={row.is_active ? "Activa" : "Inactiva"} tone={row.is_active ? "success" : "neutral"} size="sm" />
                <div className="mt-1 text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                  {row.open_issue_count} incidencia{row.open_issue_count === "1" ? "" : "s"} abierta{row.open_issue_count === "1" ? "" : "s"}
                </div>
                <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                  {row.last_evaluated_at ? `Evaluada ${new Date(row.last_evaluated_at).toLocaleDateString("es-CL")}` : "Nunca evaluada"}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex flex-col gap-2.5 md:hidden">
        {rows?.map(row => (
          <div key={row.rule_code} className="flex flex-col gap-1.5 rounded-[var(--nx-radius-card)] border p-3" style={{ borderColor: "var(--nx-border)", background: "var(--nx-card-bg)" }}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold" style={{ color: "var(--nx-text-primary)" }}>
                  {row.title}
                </div>
                <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
                  {row.rule_code} · v{row.active_rule_version}
                </div>
              </div>
              <StatusBadge label={row.is_active ? "Activa" : "Inactiva"} tone={row.is_active ? "success" : "neutral"} size="sm" />
            </div>
            <p className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
              {row.description}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge {...severityBadge(row.default_severity)} size="sm" />
              <StatusBadge label={entityTypeLabel(row.entity_type)} tone="neutral" size="sm" />
            </div>
            <div className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
              {row.open_issue_count} incidencia{row.open_issue_count === "1" ? "" : "s"} abierta{row.open_issue_count === "1" ? "" : "s"} · Última evaluación:{" "}
              {row.last_evaluated_at ? new Date(row.last_evaluated_at).toLocaleString("es-CL") : "Nunca evaluada"}
            </div>
          </div>
        ))}
      </div>
    </ResponsiveTableShell>
  );
}
