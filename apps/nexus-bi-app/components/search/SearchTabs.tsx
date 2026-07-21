"use client";

import { useRef } from "react";
import { PILL_SELECTED_DARK, PILL_UNSELECTED } from "./search.styles";
import { ENTITY_LABELS, ENTITY_ORDER } from "./search.utils";
import type { SearchCounts, SearchEntity } from "@/types/search";

interface SearchTabsProps {
  active: SearchEntity;
  counts: SearchCounts | null;
  onChange: (entity: SearchEntity) => void;
}

// Primera implementación real de tabs ARIA de esta app (los tabs de
// DashboardShell/AuditManualReviewShell no usan role="tab" - no son
// precedente a copiar acá). role="tablist"/"tab"/"tabpanel" reales,
// tabindex "roving" (0 en el activo, -1 en el resto), flechas
// izquierda/derecha + Home/End, aria-selected (nunca aria-current).
export function SearchTabs({ active, counts, onChange }: SearchTabsProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function focusAndActivate(index: number) {
    const wrapped = (index + ENTITY_ORDER.length) % ENTITY_ORDER.length;
    const entity = ENTITY_ORDER[wrapped];
    tabRefs.current[wrapped]?.focus();
    onChange(entity);
  }

  function handleKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusAndActivate(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusAndActivate(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusAndActivate(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusAndActivate(ENTITY_ORDER.length - 1);
    }
  }

  return (
    <div role="tablist" aria-label="Categorías de búsqueda" className="flex flex-wrap gap-1.5">
      {ENTITY_ORDER.map((entity, index) => {
        const isActive = entity === active;
        const count = counts ? counts[entity] : null;
        return (
          <button
            key={entity}
            ref={el => {
              tabRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`search-tab-${entity}`}
            aria-selected={isActive}
            aria-controls={`search-tabpanel-${entity}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(entity)}
            onKeyDown={event => handleKeyDown(event, index)}
            className={`rounded-[var(--nx-radius-button)] px-3.5 text-[13.5px] font-semibold ${isActive ? PILL_SELECTED_DARK : PILL_UNSELECTED}`}
          >
            {ENTITY_LABELS[entity]}
            {count !== null && <span className="ml-1.5 opacity-80">({count.toLocaleString("es-CL")})</span>}
          </button>
        );
      })}
    </div>
  );
}
