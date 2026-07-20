import { EmptyState } from "@/components/ui/EmptyState";
import { reportQualityBadge } from "@/components/ui/StatusBadge";
import { mapDataQualityRow, orderDataQualityRows } from "@/lib/fieldbeat-data-quality-view";
import { barWidthPct } from "@/lib/fieldbeat-bar-list-view";
import { formatNumberEsCl } from "@/lib/dashboard-formatters";
import type { FieldbeatDataQualityRow } from "@/types/fieldbeat";

interface FieldbeatDataQualityProps {
  rows: FieldbeatDataQualityRow[];
  totalReports: number;
  loading?: boolean;
}

// Colores por categoría (mockup: "¿Qué información está incompleta?" usa
// un color semántico DISTINTO por fila, no un solo hue) - la barra nunca
// es el único canal: cada fila lleva su etiqueta, cantidad y porcentaje en
// texto visible. #b8791c (HAS_PLACEHOLDERS) no tiene token --nx-* propio
// (ninguna otra pantalla usa ese ámbar) - se usa el valor literal
// verificado en el mockup, ya que no existe un token semántico que
// reemplazarlo violaría la regla "no copiar hex cuando exista un token".
const CATEGORY_COLOR: Record<string, string> = {
  OK: "var(--nx-accent-green)",
  NO_USED_PARTS: "var(--nx-border)",
  HAS_PLACEHOLDERS: "#b8791c",
  HAS_UNMATCHED_PARTS: "var(--nx-danger-fg)",
  HAS_AMBIGUOUS_PARTS: "var(--nx-accent-purple)",
  REVIEW_REQUIRED: "var(--nx-accent-indigo)"
};
const UNKNOWN_COLOR = "var(--nx-text-muted)";

// La derivación {label, tone} vía reportQualityBadge() vive ACÁ (capa de
// presentación, .tsx real) - lib/fieldbeat-data-quality-view.ts es pura
// TypeScript sin JSX y no importa StatusBadge.tsx (node --test con
// --experimental-strip-types no puede cargar un .tsx). Ya confirmado que
// reportQualityBadge() cubre los 6 valores reales de
// report_quality_status - se reutiliza sin modificarlo. Un status
// desconocido (view.isKnown=false) nunca lanza: se muestra como "Estado
// no reconocido", con el código crudo como texto secundario.
export function FieldbeatDataQuality({ rows, totalReports, loading = false }: FieldbeatDataQualityProps) {
  if (loading) {
    return (
      <div className="rounded-[14px] p-4.5" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}>
        <div className="space-y-2" aria-live="polite" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-5 rounded" style={{ background: "var(--nx-page-bg)" }} />
          ))}
        </div>
      </div>
    );
  }

  const ordered = orderDataQualityRows(rows);

  return (
    <div className="rounded-[14px] p-4.5" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}>
      <div className="text-[15.5px] font-bold" style={{ color: "var(--nx-text-primary)" }}>
        ¿Qué información está incompleta?
      </div>
      <div className="mb-3 mt-0.5 text-[13px]" style={{ color: "var(--nx-text-muted)" }}>
        {formatNumberEsCl(totalReports)} reportes, por estado de la información de repuestos
      </div>

      {ordered.length === 0 ? (
        <EmptyState title="Sin datos de calidad disponibles" />
      ) : (
        <ol className="space-y-2">
          {ordered.map(row => {
            const view = mapDataQualityRow(row, totalReports);
            const badge = view.isKnown ? reportQualityBadge(view.status) : { label: "Estado no reconocido" };
            const color = CATEGORY_COLOR[view.status] ?? UNKNOWN_COLOR;
            const pct = barWidthPct(view.count, totalReports);
            return (
              <li key={view.status}>
                <div className="mb-1 flex items-center justify-between gap-3 text-[13.5px]" style={{ color: "var(--nx-text-primary)" }}>
                  <span className="min-w-0 truncate">
                    {badge.label}
                    {!view.isKnown && (
                      <span className="ml-1 text-[11px]" style={{ color: "var(--nx-text-muted)" }}>
                        ({view.status})
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-semibold [font-variant-numeric:tabular-nums]">
                    {formatNumberEsCl(view.count)} · {view.percentLabel}
                  </span>
                </div>
                <div aria-hidden="true" className="h-[9px] overflow-hidden rounded-[5px]" style={{ background: "var(--nx-page-bg)" }}>
                  <div className="h-full rounded-[5px]" style={{ width: `${pct}%`, background: color }} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
