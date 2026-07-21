"use client";

import { SectionCard } from "@/components/ui/SectionCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { barWidthPct, maxOf } from "@/lib/fieldbeat-bar-list-view";
import type { FieldbeatRankingRow } from "@/lib/fieldbeat-ranking-view";

interface FieldbeatRankingCardProps {
  title: string;
  description?: string;
  rows: FieldbeatRankingRow[];
  loading?: boolean;
  barColor?: string;
}

// ETAPA 5 - ranking informativo, NUNCA interactivo (FieldBeat no tiene
// contrato de filtros - sin onClick, sin tabIndex, sin role="button", sin
// aria-pressed). Estructura semántica <ol>/<li>: nombre y valor son texto
// VISIBLE (nunca ocultos detrás de un aria-label que los reemplace), la
// barra es decorativa (aria-hidden="true"). El orden que entrega el
// backend se preserva siempre - este componente nunca reordena (ver
// lib/fieldbeat-ranking-view.ts).
export function FieldbeatRankingCard({ title, description, rows, loading = false, barColor = "var(--nx-accent-indigo)" }: FieldbeatRankingCardProps) {
  const max = maxOf(rows.map(r => r.value));

  return (
    <SectionCard title={title} description={description}>
      {loading ? (
        <div className="space-y-2" aria-live="polite" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-5 rounded" style={{ background: "var(--nx-page-bg)" }} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="Sin datos disponibles" description="No hay registros para este ranking en el universo actual." />
      ) : (
        <ol className="space-y-1.5">
          {rows.map(row => {
            const pct = barWidthPct(row.value, max);
            return (
              <li key={row.key} className="flex items-center gap-2">
                <span className="w-[45%] shrink-0 truncate text-[13px]" style={{ color: "var(--nx-text-secondary)" }} title={row.key}>
                  {row.key}
                </span>
                <span aria-hidden="true" className="relative h-3.5 flex-1 overflow-hidden rounded" style={{ background: "var(--nx-page-bg)" }}>
                  <span className="block h-full rounded" style={{ width: `${pct}%`, background: barColor }} />
                </span>
                <span className="w-16 shrink-0 text-right text-[13px] font-semibold [font-variant-numeric:tabular-nums]" style={{ color: "var(--nx-text-primary)" }}>
                  {row.valueLabel}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </SectionCard>
  );
}
