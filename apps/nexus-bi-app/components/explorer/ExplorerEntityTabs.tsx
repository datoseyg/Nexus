"use client";

import { EXPLORER_ENTITIES } from "@/lib/explorer-url-state";
import { EXPLORER_ENTITY_CONFIG } from "@/lib/explorer-entity-config";
import type { ExplorerEntity } from "@/types/explorer";
import { BASE_TRANSITION, FOCUS_RING } from "@/components/ui/interactive";

interface ExplorerEntityTabsProps {
  entity: ExplorerEntity;
  onChange: (entity: ExplorerEntity) => void;
}

// Control segmentado tipo píldora (corrección de fidelidad visual sobre la
// referencia - reemplaza las tabs de texto con subrayado que tenía el
// Explorador antes: activa = fondo oscuro/texto blanco, inactivas = fondo
// claro). role="tablist" + aria-selected + desplazamiento horizontal en
// mobile (mismo criterio de accesibilidad que las tabs de Auditoría).
export function ExplorerEntityTabs({ entity, onChange }: ExplorerEntityTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Entidades del Explorador"
      className="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-1"
    >
      {EXPLORER_ENTITIES.map(key => {
        const active = entity === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            id={`explorer-tab-${key}`}
            aria-selected={active}
            aria-controls="explorer-tabpanel"
            onClick={() => onChange(key)}
            className={`shrink-0 whitespace-nowrap rounded-[var(--nx-radius-pill)] cursor-pointer border px-3.5 py-2 text-sm font-semibold active:translate-y-px ${BASE_TRANSITION} ${FOCUS_RING} ${
              active
                ? "border-[var(--nx-sidebar-bg)] bg-[var(--nx-sidebar-bg)] text-white shadow-sm hover:bg-[#242a3d] hover:shadow-md active:bg-[#10131c]"
                : "border-[var(--nx-border)] bg-[var(--nx-card-bg)] text-[var(--nx-text-secondary)] hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-900 active:bg-indigo-100"
            }`}
          >
            {EXPLORER_ENTITY_CONFIG[key].label}
          </button>
        );
      })}
    </div>
  );
}
