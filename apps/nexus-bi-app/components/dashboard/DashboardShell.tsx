"use client";

import { useState } from "react";
import styles from "./dashboard.module.css";
import { OperationalDashboardTab } from "./OperationalDashboardTab";
import { UptimeDowntimeTab } from "./UptimeDowntimeTab";

type TabKey = "operacional" | "uptime";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "operacional", label: "Dashboard Operacional" },
  { key: "uptime", label: "Integración Uptime / Downtime" }
];

// Réplica visual de index(2).html (Proyecto 7 - Dashboard Operacional
// EyG) — ver docs/DASHBOARD_VISUAL_STYLE.md. Todos los datos vienen de
// DuckDB vía los API routes de app/api/dashboard/{operacional,uptime}/*;
// nada acá es PLACEHOLDER.
export function DashboardShell() {
  const [activeTab, setActiveTab] = useState<TabKey>("operacional");

  return (
    <div className={styles.root}>
      <div className={styles.appbar}>
        <div className={styles.appbarLeft}>
          <div className={styles.logoBadge}>EyG</div>
          <div className={styles.appbarTitle}>
            <h1>Dashboard Operacional EyG</h1>
            <span>FIELDBEAT • DOLIBARR • ZENDESK</span>
          </div>
        </div>
        <div style={{ fontSize: 12, color: "var(--db-text-muted)" }}>EyG Medical Systems</div>
      </div>

      <div className={styles.tabs}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            type="button"
            className={`${styles.tabBtn} ${activeTab === tab.key ? styles.tabBtnActive : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={styles.tabPanel}>
        {activeTab === "operacional" ? <OperationalDashboardTab /> : <UptimeDowntimeTab />}
      </div>
    </div>
  );
}
