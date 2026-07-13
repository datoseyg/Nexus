"use client";

import { useId } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchResultRow } from "./SearchResultRow";
import { ENTITY_LABELS } from "./search.utils";
import type { SearchClientResult, SearchEntity, SearchMachineResult, SearchPartResult, SearchReportResult, SearchTicketResult } from "@/types/search";

type AnyResult = SearchClientResult | SearchMachineResult | SearchReportResult | SearchTicketResult | SearchPartResult;

interface SearchGroupProps {
  entity: Exclude<SearchEntity, "all">;
  rows: AnyResult[];
  totalCount: number;
  onOpenDetail: (entity: Exclude<SearchEntity, "all">, key: string) => void;
  onViewAll?: () => void;
}

// Lista semántica de tarjetas (section + h2 + ul/li), NO ResponsiveTableShell
// - esa pieza está pensada para tablas reales, no para filas-tarjeta como
// estas (corrección explícita del encargo).
export function SearchGroup({ entity, rows, totalCount, onOpenDetail, onViewAll }: SearchGroupProps) {
  const headingId = useId();

  if (rows.length === 0) {
    return (
      <EmptyState
        title={`Sin resultados en ${ENTITY_LABELS[entity].toLowerCase()}`}
        description="No hay coincidencias para esta consulta y estos filtros."
      />
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-[var(--nx-radius-card)] p-4"
      style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}
    >
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-[12.5px] font-bold uppercase tracking-wide" style={{ color: "var(--nx-text-secondary)" }}>
          {ENTITY_LABELS[entity]} · {totalCount.toLocaleString("es-CL")}
        </h2>
        {onViewAll && totalCount > rows.length && (
          <button
            type="button"
            onClick={onViewAll}
            className="text-[13px] font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nx-focus-ring-color)]"
            style={{ color: "var(--nx-accent-indigo)", minHeight: 44 }}
          >
            Ver todos
          </button>
        )}
      </div>
      <ul role="list" className="flex flex-col gap-2">
        {rows.map(row => (
          <SearchResultRow key={row.key} entity={entity} row={row} onOpenDetail={onOpenDetail} />
        ))}
      </ul>
    </section>
  );
}
