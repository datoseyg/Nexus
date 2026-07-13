"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { OperationalDashboardTab } from "./OperationalDashboardTab";
import { UptimeDowntimeTab } from "./UptimeDowntimeTab";

type TabKey = "operacional" | "horas";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "operacional", label: "Dashboard Operacional" },
  { key: "horas", label: "Horas registradas" }
];

// Fija el lienzo y los tokens heredados por componentes reutilizados sin
// editar (PageHeader, ResponsiveTableShell, ErrorBanner - todos en
// components/ui o components/ fuera de alcance de esta etapa) a sus
// valores claros de forma explícita, en vez de heredar
// prefers-color-scheme del sistema - mismo mecanismo ya aplicado en
// Inicio (ver app/page.tsx, SHELL_STYLE) para evitar el mismo bug de
// texto oscuro sobre fondo oscuro (o viceversa) detectado en esa etapa.
const SHELL_STYLE = {
  background: "var(--nx-page-bg)",
  boxShadow: "var(--nx-shadow-shell)",
  "--eyg-card": "#ffffff",
  "--eyg-border": "#dde6e3",
  "--eyg-green-dark": "#3c8c2e",
  "--eyg-warning": "#f4b740",
  "--eyg-danger": "#d9534f",
  "--surface-1": "#ffffff",
  "--page-plane": "#f4f7f6",
  "--text-primary": "#243033",
  "--text-secondary": "#5e6b70",
  "--text-muted": "#8a9a95",
  "--gridline": "#dde6e3",
  "--axis": "#b7c9c3",
  "--border": "#dde6e3",
  "--series-1": "#3c8c2e",
  "--status-good": "#3c8c2e",
  "--status-warning": "#f4b740",
  "--status-serious": "#e08e3e",
  "--status-critical": "#d9534f"
} as React.CSSProperties;

// Réplica visual del standalone de Dashboard Operacional (ver
// docs/design-revolution/Claude-Designs/Nexus - Dashboard Operacional -
// standalone.html). Todos los datos vienen de DuckDB/Postgres vía los API
// routes de app/api/dashboard/{operacional,uptime}/* - nada acá es
// PLACEHOLDER. Único <h1> de la ruta (vía PageHeader).
export function DashboardShell() {
  const [activeTab, setActiveTab] = useState<TabKey>("operacional");

  return (
    <div className="overflow-hidden rounded-[var(--nx-radius-shell)]" style={SHELL_STYLE}>
      <div className="p-5 sm:p-7" style={{ background: "var(--nx-card-bg)", borderBottom: "1px solid var(--nx-border)" }}>
        <PageHeader
          eyebrow="FieldBeat · Dolibarr · Zendesk"
          title="Dashboard Operacional"
          description="Resumen de la actividad de mantenimiento técnico: servicios realizados, clientes atendidos y repuestos utilizados."
        />

        <nav className="mt-4 flex gap-1 overflow-x-auto" aria-label="Secciones del Dashboard Operacional">
          {TABS.map(tab => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                aria-current={active ? "page" : undefined}
                className="whitespace-nowrap rounded-t-[var(--nx-radius-button)] px-5 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nx-focus-ring-color)]"
                style={{
                  background: active ? "var(--nx-page-bg)" : "transparent",
                  color: active ? "var(--nx-text-primary)" : "var(--nx-text-secondary)",
                  minHeight: 44
                }}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="p-5 sm:p-7">{activeTab === "operacional" ? <OperationalDashboardTab /> : <UptimeDowntimeTab />}</div>
    </div>
  );
}
