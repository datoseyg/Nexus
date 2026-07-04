"use client";

import { useEffect, useState } from "react";
import { MetricCard } from "@/components/ui/MetricCard";
import { SectionCard } from "@/components/ui/SectionCard";
import { ErrorBanner } from "@/components/ErrorBanner";
import type { AuditSummary } from "@/types/audit";

// Alimenta la pestaña "Resumen de calidad" - ver
// docs/MANUAL_REVIEW_VIEW.md § F. Todos los números vienen de
// gold.fieldbeat_data_quality / gold.scope_metadata vía
// /api/audit/summary; nada se calcula de nuevo acá.
export function QualitySummarySection() {
  const [data, setData] = useState<AuditSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/audit/summary")
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw body;
        setData(body);
      })
      .catch(body => setError(body?.error ?? "Error desconocido"));
  }, []);

  if (error) return <ErrorBanner message={error} />;
  if (!data) return <p style={{ color: "var(--text-muted)" }}>Cargando resumen de calidad…</p>;

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Reportes FieldBeat" description={`${data.totalFieldbeatReports.toLocaleString("es-CL")} reportes totales`}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MetricCard label="Reportes OK" value={data.reportsOk} tone="success" />
          <MetricCard label="Reportes con revisión requerida" value={data.reportsReviewRequired} tone="warning" />
          <MetricCard label="Sin ticket reportado" value={data.reportsNoTicket} />
          <MetricCard label="Ticket faltante / restringido" value={data.reportsLinkedMissingOrRestricted} tone="danger" />
        </div>
      </SectionCard>

      <SectionCard title="Repuestos Dolibarr" description="Universo report-céntrico completo (marts.used_parts_dolibarr_match)">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard label="Matched" value={data.partsMatched} tone="success" />
          <MetricCard label="Sin match" value={data.partsUnmatched} tone="danger" />
          <MetricCard label="Ambiguos" value={data.partsAmbiguous} tone="warning" />
          <MetricCard label="Placeholders" value={data.partsPlaceholder} />
        </div>
      </SectionCard>

      <SectionCard
        title="Tickets Zendesk pendientes por permisos de token"
        description="Ver CLAUDE.md § Pendientes conocidos para Fase 2 - no hay nada más que hacer con el token actual."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MetricCard label="Tickets 403 Forbidden pendientes" value={data.ticketsForbiddenPending} tone="warning" />
        </div>
      </SectionCard>
    </div>
  );
}
