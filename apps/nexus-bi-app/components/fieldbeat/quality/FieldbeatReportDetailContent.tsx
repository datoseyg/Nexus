"use client";

import { useEffect } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { useAfterHoursSection } from "@/lib/use-after-hours-section";
import { EQUIPMENT_SOURCE_LABEL, TEAM_IDENTIFICATION_STATUS_LABEL, formatFieldbeatDateTime } from "@/lib/fieldbeat-report-labels";
import type { FieldbeatReportDetail } from "@/types/fieldbeat-report-detail";

function isReportDetailEmpty(): boolean {
  // Un detalle no tiene noción de "vacío" - existe (200), no existe (404,
  // que useAfterHoursSection ya trata como error con el mensaje del
  // servidor), o falla (error). Nunca "empty".
  return false;
}

const SEVERITY_STYLE: Record<string, { bg: string; fg: string }> = {
  Alta: { bg: "var(--nx-danger-bg, #fdecea)", fg: "var(--nx-danger-fg, #b3261e)" },
  Media: { bg: "var(--nx-warning-bg, #fff4e0)", fg: "var(--nx-warning-fg, #8a5a00)" },
  Baja: { bg: "var(--nx-page-bg)", fg: "var(--nx-text-secondary)" },
  Advertencia: { bg: "var(--nx-page-bg)", fg: "var(--nx-text-secondary)" }
};

function SeverityBadge({ severity }: { severity: string }) {
  const style = SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.Baja;
  return (
    <span className="inline-flex items-center gap-1 rounded-[var(--nx-radius-chip)] px-2 py-0.5 text-[11.5px] font-semibold" style={{ background: style.bg, color: style.fg }}>
      {severity}
    </span>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11.5px] font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
        {label}
      </dt>
      <dd className="text-[13px]" style={{ color: "var(--nx-text-primary)" }}>
        {value}
      </dd>
    </div>
  );
}

const formatDateTime = formatFieldbeatDateTime;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t pt-3.5 first:border-t-0 first:pt-0" style={{ borderColor: "var(--nx-border)" }}>
      <h3 className="text-[12.5px] font-bold uppercase tracking-wide" style={{ color: "var(--nx-text-secondary)" }}>
        {title}
      </h3>
      {children}
    </section>
  );
}

interface FieldbeatReportDetailContentProps {
  reportId: string;
  onMeta?: (meta: { generatedAt: string; fieldbeatOpenAvailable: boolean } | null) => void;
}

// Contenido del detalle maestro (Phase 5) - solo se monta mientras el
// drawer está open=true (montaje condicional en FieldbeatReportDetailDrawer),
// garantizando cero requests antes de abrir y cancelación real vía
// useAfterHoursSection (AbortController + requestId) al cambiar de
// reportId con el drawer abierto.
export function FieldbeatReportDetailContent({ reportId, onMeta }: FieldbeatReportDetailContentProps) {
  const { status, data, error, retry } = useAfterHoursSection<FieldbeatReportDetail>(`/api/dashboard/fieldbeat/reports/${reportId}`, "", isReportDetailEmpty);
  const loading = status === "idle" || status === "loading" || status === "refreshing";

  useEffect(() => {
    onMeta?.(data ? { generatedAt: data.generatedAt, fieldbeatOpenAvailable: data.audit.fieldbeatOpenAvailable } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (status === "error") {
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <ErrorBanner message={error ?? "No fue posible cargar el detalle del reporte."} />
        <button
          type="button"
          onClick={retry}
          className="rounded-[var(--nx-radius-chip)] px-3.5 py-1.5 text-[13px] font-semibold"
          style={{ background: "var(--nx-accent-indigo)", color: "#fff" }}
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div aria-busy="true" aria-live="polite" className="flex flex-col gap-3">
        <span className="sr-only">Cargando detalle del reporte…</span>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-[var(--nx-radius-card)]" style={{ background: "var(--nx-page-bg)" }} />
        ))}
      </div>
    );
  }

  const primary = data.inconsistencies.find(f => f.isPrimary) ?? null;
  const secondary = data.inconsistencies.filter(f => !f.isPrimary);

  return (
    <div className="flex flex-col gap-4">
      <div aria-live="polite" className="sr-only">
        Detalle del reporte {data.report.fieldbeatTaskId} cargado.
      </div>

      {/* 1. Identidad (el título "Reporte FieldBeat <id>" ya lo muestra DetailDrawer) */}
      <Section title="Identidad">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <Field label="Estado" value={data.report.state ?? "Sin información"} />
          <Field label="Fecha" value={formatDateTime(data.report.fieldbeatTaskDate)} />
          <Field label="Tipo de tarea" value={data.report.taskType ?? "Sin información"} />
          <Field label="Origen" value={data.report.origen ?? "Sin información"} />
          <Field label="Estado de calidad" value={data.report.reportQualityStatus ?? "Sin información"} />
          <Field label="Severidad principal" value={primary ? <SeverityBadge severity={primary.severity} /> : "Sin inconsistencias"} />
        </dl>
      </Section>

      {/* 2. Resumen de calidad */}
      <Section title="Resumen de calidad">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <Field label="Completitud estructural" value={data.quality.structurallyComplete ? "Cumple" : "No cumple"} />
          <Field label="Campos mínimos" value={data.quality.minimumFieldsComplete ? "Completos" : "Incompletos"} />
          <Field label="Identificación de equipo" value={TEAM_IDENTIFICATION_STATUS_LABEL[data.equipment.status] ?? data.equipment.status} />
          <Field label="Trazabilidad de repuestos" value={data.quality.partTotalLines === 0 ? "Sin repuestos" : data.quality.partFullyTraceable ? "Totalmente trazable" : "Con brechas"} />
          <Field
            label="Consistencia temporal"
            value={data.quality.hasSufficientTimestamps ? (data.quality.chronologyImpossible ? "Cronología imposible" : "Consistente") : "Sin información suficiente"}
          />
          <Field
            label="Ticket"
            value={
              data.quality.ticketAccessible === null && !data.quality.ticketMissingOrRestricted
                ? "Sin ticket informado"
                : data.quality.ticketMissingOrRestricted
                  ? "Restringido o ausente"
                  : "Accesible"
            }
          />
        </dl>
      </Section>

      {/* 3. Inconsistencias */}
      <Section title={`Inconsistencias (${data.inconsistencies.length})`}>
        {data.inconsistencies.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--nx-text-secondary)" }}>
            Sin inconsistencias detectadas para este reporte.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {primary && (
              <div className="rounded-[var(--nx-radius-card)] border-2 p-3" style={{ borderColor: SEVERITY_STYLE[primary.severity]?.fg ?? "var(--nx-border)" }}>
                <div className="mb-1 flex items-center gap-2">
                  <SeverityBadge severity={primary.severity} />
                  <span className="text-[12px] font-bold" style={{ color: "var(--nx-text-primary)" }}>
                    {primary.code} (principal)
                  </span>
                </div>
                <p className="text-[12.5px]" style={{ color: "var(--nx-text-secondary)" }}>
                  {primary.explanation}
                </p>
                <p className="mt-1 text-[12px] italic" style={{ color: "var(--nx-text-secondary)" }}>
                  {primary.suggestedAction}
                </p>
              </div>
            )}
            {secondary.length > 0 && (
              <details>
                <summary className="cursor-pointer text-[12.5px] font-semibold" style={{ color: "var(--nx-accent-indigo)" }}>
                  {secondary.length} inconsistencia(s) adicional(es)
                </summary>
                <div className="mt-2 flex flex-col gap-2">
                  {secondary.map(f => (
                    <div key={f.code} className="rounded-[var(--nx-radius-card)] border p-2.5" style={{ borderColor: "var(--nx-border)" }}>
                      <div className="mb-1 flex items-center gap-2">
                        <SeverityBadge severity={f.severity} />
                        <span className="text-[12px] font-semibold" style={{ color: "var(--nx-text-primary)" }}>
                          {f.code}
                        </span>
                      </div>
                      <p className="text-[12px]" style={{ color: "var(--nx-text-secondary)" }}>
                        {f.explanation}
                      </p>
                      <p className="mt-1 text-[11.5px] italic" style={{ color: "var(--nx-text-secondary)" }}>
                        {f.suggestedAction}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </Section>

      {/* 4. Cronología */}
      <Section title="Cronología">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <Field label="Creación" value={formatDateTime(data.chronology.createdAt)} />
          <Field label="Inicio" value={formatDateTime(data.chronology.startTime)} />
          <Field label="Última transición" value={formatDateTime(data.chronology.lastTransitionAt)} />
          <Field
            label="Duración"
            value={
              data.chronology.durationMinutes === null
                ? "Sin registrar"
                : data.chronology.durationMinutes === 0
                  ? "0 minutos (advertencia)"
                  : `${data.chronology.durationMinutes.toLocaleString("es-CL")} min`
            }
          />
        </dl>
        {data.chronology.chronologyImpossible && (
          <p className="text-[12px] font-semibold" style={{ color: "var(--nx-danger-fg, #b3261e)" }}>
            Cronología imposible: la última transición ocurre antes del inicio registrado.
          </p>
        )}
      </Section>

      {/* 5. Técnico y cliente */}
      <Section title="Técnico y cliente">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <Field label="Técnico" value={data.technician?.name ?? "Sin información"} />
          <Field label="Cliente" value={data.client?.clientName ?? "Sin información"} />
        </dl>
      </Section>

      {/* 6. Equipos */}
      <Section title={`Equipos (${data.equipment.items.length})`}>
        {data.equipment.items.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--nx-text-secondary)" }}>
            {TEAM_IDENTIFICATION_STATUS_LABEL[data.equipment.status] ?? "Sin equipo identificado"}.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {data.equipment.items.map(item => (
              <li key={`${item.source}-${item.internalId}`} className="flex items-center justify-between rounded-[var(--nx-radius-chip)] border px-2.5 py-1.5" style={{ borderColor: "var(--nx-border)" }}>
                <span className="text-[13px]" style={{ color: "var(--nx-text-primary)" }}>
                  {item.internalId}
                </span>
                <span className="text-[11.5px]" style={{ color: item.confirmed ? "var(--nx-text-secondary)" : "var(--nx-warning-fg, #8a5a00)" }}>
                  {EQUIPMENT_SOURCE_LABEL[item.source]}
                  {!item.confirmed && " (sin confirmar)"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 7. Tickets */}
      <Section title={`Tickets (${data.tickets.length})`}>
        {data.tickets.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--nx-text-secondary)" }}>
            Sin tickets informados.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {data.tickets.map(t => (
              <li key={t.zendeskTicketId} className="rounded-[var(--nx-radius-chip)] border px-2.5 py-1.5" style={{ borderColor: "var(--nx-border)" }}>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold" style={{ color: "var(--nx-text-primary)" }}>
                    #{t.zendeskTicketId}
                  </span>
                  <span className="text-[11.5px]" style={{ color: "var(--nx-text-secondary)" }}>
                    {t.status ?? "Sin información"}
                  </span>
                </div>
                {t.subject && (
                  <p className="text-[12px]" style={{ color: "var(--nx-text-secondary)" }}>
                    {t.subject}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 8. Repuestos */}
      <Section title={`Repuestos (${data.parts.length})`}>
        {data.parts.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--nx-text-secondary)" }}>
            Sin repuestos registrados.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.parts.map(p => (
              <li key={p.usedPartId} className="rounded-[var(--nx-radius-card)] border p-2.5" style={{ borderColor: "var(--nx-border)" }}>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold" style={{ color: "var(--nx-text-primary)" }}>
                    {p.partName ?? p.rawPartIdentifier ?? "Sin descripción"}
                  </span>
                  <span className="text-[11.5px]" style={{ color: "var(--nx-text-secondary)" }}>
                    Cant.: {p.quantity === null ? "Sin registrar" : p.quantity}
                  </span>
                </div>
                <p className="text-[12px]" style={{ color: "var(--nx-text-secondary)" }}>
                  {p.historicalMatchStatus ?? "Sin clasificar"}
                  {p.dolibarrProduct && ` · ${p.dolibarrProduct.label ?? p.dolibarrProduct.ref ?? p.dolibarrProduct.productId}`}
                </p>
                {p.ambiguousCandidateProductIds.length > 0 && (
                  <p className="text-[11.5px] italic" style={{ color: "var(--nx-warning-fg, #8a5a00)" }}>
                    Candidatos (sin confirmar): {p.ambiguousCandidateProductIds.join(", ")}
                  </p>
                )}
                {p.historicalAlias && (
                  <p className="text-[11.5px] italic" style={{ color: "var(--nx-text-secondary)" }}>
                    Alias histórico: {p.historicalAlias.aliasValue}
                    {p.historicalAlias.reason && ` (${p.historicalAlias.reason})`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 9. Auditoría */}
      <Section title="Auditoría">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <Field label="Versión de contrato" value={data.audit.contractVersion} />
          <Field label="Generado" value={formatDateTime(data.audit.generatedAt)} />
        </dl>
      </Section>
    </div>
  );
}
