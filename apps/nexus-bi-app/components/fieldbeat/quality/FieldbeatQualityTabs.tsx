"use client";

import { useRef } from "react";
import { FIELDBEAT_TABS, type FieldbeatTab } from "@/lib/fieldbeat-tabs-url-state";

interface FieldbeatQualityTabsProps {
  active: FieldbeatTab;
  onChange: (tab: FieldbeatTab) => void;
}

const TAB_LABELS: Record<FieldbeatTab, string> = {
  overview: "Visión ejecutiva",
  quality: "Calidad y trazabilidad",
  crossings: "Cruces",
  reports: "Reportes"
};

// Mismo patrón ARIA que components/search/SearchTabs.tsx (única
// implementación real de tabs de NEXUS con role="tablist"/"tab" +
// tabindex roving + flechas - los tabs de DashboardShell/
// AuditManualReviewShell NO son precedente, no usan roles ARIA reales).
export function FieldbeatQualityTabs({ active, onChange }: FieldbeatQualityTabsProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function focusAndActivate(index: number) {
    const wrapped = (index + FIELDBEAT_TABS.length) % FIELDBEAT_TABS.length;
    const tab = FIELDBEAT_TABS[wrapped];
    tabRefs.current[wrapped]?.focus();
    onChange(tab);
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
      focusAndActivate(FIELDBEAT_TABS.length - 1);
    }
  }

  return (
    <div role="tablist" aria-label="Secciones del dashboard FieldBeat" className="flex flex-wrap gap-1.5">
      {FIELDBEAT_TABS.map((tab, index) => {
        const isActive = tab === active;
        return (
          <button
            key={tab}
            ref={el => {
              tabRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`fieldbeat-tab-${tab}`}
            aria-selected={isActive}
            aria-controls={`fieldbeat-tabpanel-${tab}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab)}
            onKeyDown={event => handleKeyDown(event, index)}
            className="rounded-[var(--nx-radius-button)] px-3.5 py-1.5 text-[13.5px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nx-focus-ring-color)]"
            style={
              isActive
                ? { background: "var(--nx-accent-indigo)", color: "#fff" }
                : { background: "transparent", color: "var(--nx-text-secondary)", border: "1px solid var(--nx-border)" }
            }
          >
            {TAB_LABELS[tab]}
          </button>
        );
      })}
    </div>
  );
}
