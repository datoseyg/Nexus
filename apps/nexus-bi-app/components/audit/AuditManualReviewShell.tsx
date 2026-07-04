"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { PartsReviewSection } from "./PartsReviewSection";
import { AmbiguousPartsSection } from "./AmbiguousPartsSection";
import { PlaceholdersSection } from "./PlaceholdersSection";
import { ReportsReviewSection } from "./ReportsReviewSection";
import { TicketLinksReviewSection } from "./TicketLinksReviewSection";
import { QualitySummarySection } from "./QualitySummarySection";

type TabKey = "parts" | "ambiguous" | "placeholders" | "reports" | "tickets" | "quality";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "parts", label: "Repuestos por revisar" },
  { key: "ambiguous", label: "Matches ambiguos" },
  { key: "placeholders", label: "Placeholders" },
  { key: "reports", label: "Reportes con revisión requerida" },
  { key: "tickets", label: "Tickets faltantes o restringidos" },
  { key: "quality", label: "Resumen de calidad" }
];

// Vista de solo lectura para revisar todo lo que el sistema marca como
// poco confiable, ambiguo o pendiente de validación manual - ver
// docs/MANUAL_REVIEW_VIEW.md. NO escribe en ninguna tabla; las acciones
// de curación están preparadas pero deshabilitadas (FutureActionButton)
// hasta que exista el Centro de Correcciones.
export function AuditManualReviewShell() {
  const [activeTab, setActiveTab] = useState<TabKey>("parts");
  const [options, setOptions] = useState<{ clientes: string[]; maquinas: string[] } | null>(null);

  useEffect(() => {
    fetch("/api/dashboard/operacional/filters")
      .then(res => res.json())
      .then(body => setOptions({ clientes: body.clientes ?? [], maquinas: body.maquinas ?? [] }))
      .catch(() => setOptions({ clientes: [], maquinas: [] }));
  }, []);

  const clientes = options?.clientes ?? [];
  const maquinas = options?.maquinas ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Solo lectura - preparado para curación"
        title="Auditoría y Validación Manual"
        description="Repuestos ambiguos, no matcheados, placeholders, reportes con revisión requerida y tickets faltantes o restringidos. Ninguna acción de esta pantalla escribe todavía en el pipeline - ver docs/MANUAL_REVIEW_VIEW.md."
      />

      <div className="flex flex-wrap gap-1 border-b" style={{ borderColor: "var(--eyg-border)" }}>
        {TABS.map(tab => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className="rounded-t-lg px-3 py-2 text-sm font-semibold"
              style={{
                color: active ? "var(--eyg-green-dark)" : "var(--text-muted)",
                borderBottom: active ? "2px solid var(--eyg-green-dark)" : "2px solid transparent"
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div>
        {!options ? (
          <p style={{ color: "var(--text-muted)" }}>Cargando…</p>
        ) : (
          <>
            {activeTab === "parts" && <PartsReviewSection clientes={clientes} maquinas={maquinas} />}
            {activeTab === "ambiguous" && <AmbiguousPartsSection clientes={clientes} maquinas={maquinas} />}
            {activeTab === "placeholders" && <PlaceholdersSection clientes={clientes} maquinas={maquinas} />}
            {activeTab === "reports" && <ReportsReviewSection clientes={clientes} maquinas={maquinas} />}
            {activeTab === "tickets" && <TicketLinksReviewSection clientes={clientes} maquinas={maquinas} />}
            {activeTab === "quality" && <QualitySummarySection />}
          </>
        )}
      </div>
    </div>
  );
}
