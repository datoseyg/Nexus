"use client";

import { EXPLORER_ENTITIES } from "@/lib/explorer-url-state";
import { EXPLORER_ENTITY_CONFIG } from "@/lib/explorer-entity-config";
import type { ExplorerEntity } from "@/types/explorer";

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
            className="shrink-0 whitespace-nowrap rounded-[var(--nx-radius-pill)] px-3.5 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{
              background: active ? "var(--nx-sidebar-bg)" : "var(--nx-card-bg)",
              color: active ? "var(--nx-sidebar-text-primary)" : "var(--nx-text-secondary)",
              border: active ? "1px solid var(--nx-sidebar-bg)" : "1px solid var(--nx-border)",
              outlineColor: "var(--nx-focus-ring-color)"
            }}
          >
            {EXPLORER_ENTITY_CONFIG[key].label}
          </button>
        );
      })}
    </div>
  );
}
