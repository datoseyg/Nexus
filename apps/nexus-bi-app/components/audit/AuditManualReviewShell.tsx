"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { QualitySummarySection } from "./QualitySummarySection";
import { GovernanceKpisSection } from "./GovernanceKpisSection";
import { IssuesBandejaSection } from "./IssuesBandejaSection";
import { ReviewCasesSection } from "./ReviewCasesSection";
import { CorreccionesSection } from "./CorreccionesSection";
import { ReglasSection } from "./ReglasSection";
import { HistorialSection } from "./HistorialSection";
import { FuentesPipelineSection } from "./FuentesPipelineSection";
import { AUDIT_TABS, DEFAULT_AUDIT_TAB, auditTabLabel, buildAuditTabQuery, readAuditTab, type AuditTab } from "@/lib/audit-manual-review-url-state";
import { evaluationRunStatusLabel } from "@/lib/audit-vocabulary";
import { hasCapability } from "@/lib/auth/capabilities-shared";
import { useDataRefreshEpoch } from "@/components/data-refresh/DataRefreshEpochProvider";
import { BASE_TRANSITION, FOCUS_RING, BUTTON_GHOST } from "@/components/ui/interactive";

interface AuditManualReviewShellProps {
  role: "gerencia" | "administracion";
  capabilities: string[];
}

interface LastRunInfo {
  status: string;
  finishedAt: string | null;
  startedAt: string;
}

// Gate B - Familia 8 + QA visual: los 7 tabs requeridos por el diseño
// (Resumen/Bandeja/Casos/Correcciones/Reglas/Historial/Fuentes y pipeline).
// "Resumen de calidad" (marts) queda absorbido dentro de "Resumen", junto a
// los KPIs de gobierno (sin tocar el resumen de marts existente ni el badge
// del NavBar que depende de él); los workbenches de repuestos/ambiguos/
// placeholders/reportes/tickets viven como sub-pestañas DENTRO de
// "Correcciones" (contexto de negocio completo donde se aplican las
// correcciones - Familias 1/2/5, nunca se retiran).
//
// La pestaña activa vive en la URL (?tab=inbox|summary|cases|corrections|
// rules|history|sources - lib/audit-manual-review-url-state.ts) - mismo
// idioma que lib/fieldbeat-tabs-url-state.ts (useSearchParams + router.push,
// nunca useState local no persistido) para que back/forward y enlaces
// directos funcionen.
export function AuditManualReviewShell({ role, capabilities }: AuditManualReviewShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = readAuditTab(searchParams);
  const canReview = hasCapability(capabilities, "audit:review");
  const epoch = useDataRefreshEpoch();

  const [options, setOptions] = useState<{ clientes: string[]; maquinas: string[] } | null>(null);
  const [lastRun, setLastRun] = useState<LastRunInfo | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    fetch("/api/dashboard/operacional/filters")
      .then(res => res.json())
      .then(body => setOptions({ clientes: body.clientes ?? [], maquinas: body.maquinas ?? [] }))
      .catch(() => setOptions({ clientes: [], maquinas: [] }));
  }, []);

  useEffect(() => {
    fetch("/api/audit/evaluation-runs?page=1&pageSize=1")
      .then(res => res.json())
      .then(body => {
        const row = body.rows?.[0];
        if (row) setLastRun({ status: row.status, finishedAt: row.finished_at, startedAt: row.started_at });
      })
      .catch(() => setLastRun(null));
  }, [epoch]);

  function setTab(tab: AuditTab) {
    const qs = buildAuditTabQuery(tab);
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Desde Resumen, una tarjeta/barra de KPI navega a Bandeja con el mismo
  // filtro que explica ese número (Gate A - "contexto antes que KPI
  // aislado"): nunca un número sin salida hacia el backlog real.
  function navigateToInbox(filters?: Record<string, string>) {
    const params = new URLSearchParams();
    params.set("tab", DEFAULT_AUDIT_TAB);
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (value) params.set(key, value);
      }
    }
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const clientes = options?.clientes ?? [];
  const maquinas = options?.maquinas ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[var(--nx-radius-card)] p-4" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <PageHeader
              eyebrow={canReview ? "Auditoría gobernada activa" : "Solo lectura"}
              title="Auditoría y Validación Manual"
              description="Incidencias, casos y correcciones bajo gobierno - cada acción de escritura queda versionada, auditada y verificada."
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {lastRun && (
              <span
                className="rounded-full border px-3 py-1.5 text-xs font-semibold"
                style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)" }}
                title={`Estado: ${evaluationRunStatusLabel(lastRun.status)}`}
              >
                Última evaluación: {new Date(lastRun.finishedAt ?? lastRun.startedAt).toLocaleString("es-CL")}
              </span>
            )}
            <button
              type="button"
              onClick={() => setHelpOpen(v => !v)}
              aria-expanded={helpOpen}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${BUTTON_GHOST}`}
              style={{ borderColor: "var(--nx-border)", color: "var(--nx-accent-indigo)" }}
            >
              {helpOpen ? "Ocultar detalle" : "Qué incluye esta vista"}
            </button>
          </div>
        </div>

        {helpOpen && (
          <div className="mt-3 rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)" }}>
            {canReview
              ? "Incidencias, casos de revisión, correcciones (alias de repuesto/identidad de técnico/vínculo de ticket/identificación de equipo), catálogo de reglas, historial de eventos y estado del evaluador. Cada corrección queda versionada con actor, razón y verificación posterior - nunca se sobrescribe una decisión anterior."
              : "Vista de lectura completa de incidencias, casos de revisión, correcciones, reglas, historial y estado del evaluador. Las acciones de corrección requieren capacidades de escritura - esta vista muestra el mismo contenido, sin los controles de escritura."}
          </div>
        )}

        <div
          role="tablist"
          aria-label="Secciones de Auditoría"
          className="mt-3 -mx-1 flex gap-1 overflow-x-auto border-b px-1 pb-px"
          style={{ borderColor: "var(--nx-border)" }}
        >
          {AUDIT_TABS.map(tab => {
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                id={`audit-tab-${tab}`}
                aria-selected={active}
                aria-controls={`audit-tabpanel-${tab}`}
                onClick={() => setTab(tab)}
                className={`shrink-0 whitespace-nowrap rounded-t-lg cursor-pointer px-3.5 py-2.5 text-sm font-semibold hover:bg-[rgba(74,85,212,0.06)] active:bg-[rgba(74,85,212,0.12)] ${BASE_TRANSITION} ${FOCUS_RING}`}
                style={{
                  color: active ? "var(--nx-accent-indigo)" : "var(--nx-text-primary)",
                  borderBottom: active ? "2.5px solid var(--nx-accent-indigo)" : "2.5px solid transparent"
                }}
              >
                {auditTabLabel(tab)}
              </button>
            );
          })}
        </div>
      </div>

      <div
        role="tabpanel"
        id={`audit-tabpanel-${activeTab}`}
        aria-labelledby={`audit-tab-${activeTab}`}
        tabIndex={0}
      >
        {activeTab === "summary" && (
          <div className="flex flex-col gap-6">
            <GovernanceKpisSection onNavigateToInbox={navigateToInbox} />
            <div>
              <div className="mb-2 text-sm font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
                Resumen de calidad (marts)
              </div>
              <QualitySummarySection />
            </div>
          </div>
        )}
        {activeTab === "inbox" && <IssuesBandejaSection role={role} capabilities={capabilities} />}
        {activeTab === "cases" && <ReviewCasesSection role={role} capabilities={capabilities} />}
        {activeTab === "corrections" &&
          (!options ? (
            <p style={{ color: "var(--text-muted)" }}>Cargando…</p>
          ) : (
            <CorreccionesSection clientes={clientes} maquinas={maquinas} role={role} capabilities={capabilities} />
          ))}
        {activeTab === "rules" && <ReglasSection />}
        {activeTab === "history" && <HistorialSection role={role} capabilities={capabilities} />}
        {activeTab === "sources" && <FuentesPipelineSection />}
      </div>
    </div>
  );
}
