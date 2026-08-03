"use client";

import { useEffect } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { EquipmentIdentificationCorrectionAction } from "@/components/audit/EquipmentIdentificationCorrectionAction";
import { useAfterHoursSection } from "@/lib/use-after-hours-section";
import { hasCapability } from "@/lib/auth/capabilities-shared";
import {
  EQUIPMENT_SOURCE_LABEL,
  TEAM_IDENTIFICATION_STATUS_LABEL,
  CATALOG_MATCH_STATUS_LABEL,
  PARTICIPANT_ROLE_LABEL,
  PARTICIPANT_RESOLUTION_STATUS_LABEL,
  formatFieldbeatDateTime
} from "@/lib/fieldbeat-report-labels";
import { formatModelCell } from "@/lib/explorer-entity-config";
import { contractStatusLabel, spaTierLabel, partsCoverageLabel } from "@/lib/contracts-vocabulary";
import { ContractCoverageScheduleView } from "@/components/contracts/ContractCoverageScheduleView";
import type { FieldbeatReportDetail, FieldbeatContractRelation } from "@/types/fieldbeat-report-detail";
import type { AfterHoursDrawerContext } from "@/lib/after-hours-detail-view";

// Bloque 2 NEXUS V3 - "Horario aplicado al cálculo" SOLO existe cuando hay
// un data_basis de tarea contra el cual comparar (contexto After-Hours);
// fuera de ese contexto (equipo de un reporte sin afterHoursContext),
// ContractCoverageScheduleView se monta sin appliedSource, nunca inventando
// una comparación que no aplica. El horario global NUNCA se presenta como
// si fuera parte del contrato - por eso dataBasisCode decide el texto, no
// se asume "contractual" por default.
function contractAppliedSource(afterHoursContext: AfterHoursDrawerContext | null | undefined): { label: string; reason?: string | null } | undefined {
  if (!afterHoursContext) return undefined;
  switch (afterHoursContext.dataBasisCode) {
    case "CONTRACTUAL":
      return { label: "Horario contractual del equipo" };
    case "LEGACY_SCHEDULE":
      return { label: "Horario global de respaldo", reason: afterHoursContext.finalReason.label };
    case "NONE":
      return { label: "Sin horario calculable" };
    default:
      return undefined;
  }
}

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
  /** Opcional (Gate B, Familia 5) - solo Explorador lo pasa hoy (ya tiene
   * `role` disponible). Búsqueda y FieldBeat Quality no lo pasan. */
  role?: "gerencia" | "administracion";
  /** Idem role - determina si la acción de corrección de equipo
   * (correction:equipment-identification) se ofrece. Sin capabilities
   * (Búsqueda y FieldBeat Quality) el comportamiento queda idéntico al de
   * antes: sin acción de corrección visible. */
  capabilities?: string[];
  /** Sección 14 del encargo NEXUS V3 After-Hours - ver mismo comentario en
   * FieldbeatReportDetailDrawer.tsx. Solo After-Hours lo pasa hoy. */
  afterHoursContext?: AfterHoursDrawerContext | null;
}

// Contenido del detalle maestro (Phase 5) - solo se monta mientras el
// drawer está open=true (montaje condicional en FieldbeatReportDetailDrawer),
// garantizando cero requests antes de abrir y cancelación real vía
// useAfterHoursSection (AbortController + requestId) al cambiar de
// reportId con el drawer abierto.
export function FieldbeatReportDetailContent({ reportId, onMeta, capabilities, afterHoursContext }: FieldbeatReportDetailContentProps) {
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

      {/* 5. Responsable principal y cliente */}
      <Section title="Responsable principal y cliente">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <Field label="Responsable principal" value={data.technician?.name ?? "Sin información"} />
          <Field label="Cliente" value={data.client?.clientName ?? "Sin información"} />
        </dl>
      </Section>

      {/* 5b. Participantes (HOTFIX de integridad de datos, sql/088) - 0..N,
          incluye SIEMPRE al responsable principal primero; un participante
          no resoluble NUNCA se oculta - aparece con su rol/estado explícitos. */}
      <Section title={`Participantes (${data.participants.length})`}>
        {data.participants.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--nx-text-secondary)" }}>
            Sin participantes registrados.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {data.participants.map((p, i) => (
              <li
                key={`${p.role}-${p.rawName}-${i}`}
                className="flex items-center justify-between rounded-[var(--nx-radius-chip)] border px-2.5 py-1.5"
                style={{ borderColor: "var(--nx-border)" }}
              >
                <span className="text-[13px]" style={{ color: "var(--nx-text-primary)" }}>
                  {p.rawName}
                  {p.isPrimary && (
                    <span className="ml-1.5 text-[11px] font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
                      (principal)
                    </span>
                  )}
                </span>
                <span
                  className="text-[11.5px]"
                  style={{ color: p.resolutionStatus.startsWith("UNRESOLVED") ? "var(--nx-warning-fg, #8a5a00)" : "var(--nx-text-secondary)" }}
                  title={PARTICIPANT_RESOLUTION_STATUS_LABEL[p.resolutionStatus] ?? p.resolutionStatus}
                >
                  {PARTICIPANT_ROLE_LABEL[p.role] ?? p.role}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 5c. Duración e intervención (HOTFIX de integridad de datos) - real
          (declarada/transición validada) SEPARADA de la estimación de
          agenda, NUNCA una sustituye a la otra ni se mezclan en horas-persona. */}
      <Section title="Duración e intervención">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <Field
            label="Duración real"
            value={data.labor.actualReportDurationMinutes === null ? "Duración real no disponible" : `${data.labor.actualReportDurationMinutes.toLocaleString("es-CL")} min`}
          />
          <Field
            label="Duración estimada (agenda)"
            value={data.labor.scheduledEstimateMinutes === null ? "Sin registrar" : `${data.labor.scheduledEstimateMinutes.toLocaleString("es-CL")} min (estimado, no medido)`}
          />
          <Field label="Participantes" value={data.labor.participantCount.toLocaleString("es-CL")} />
          <Field
            label="Minutos-persona"
            value={data.labor.totalLaborMinutes === null ? "Sin datos suficientes" : `${data.labor.totalLaborMinutes.toLocaleString("es-CL")} min-persona`}
          />
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
              <li key={`${item.source}-${item.internalId}`} className="rounded-[var(--nx-radius-chip)] border px-2.5 py-1.5" style={{ borderColor: "var(--nx-border)" }}>
                <div className="flex items-center justify-between">
                  <span className="text-[13px]" style={{ color: "var(--nx-text-primary)" }}>
                    {item.internalId}
                  </span>
                  <span className="text-[11.5px]" style={{ color: item.confirmed ? "var(--nx-text-secondary)" : "var(--nx-warning-fg, #8a5a00)" }}>
                    {EQUIPMENT_SOURCE_LABEL[item.source]}
                    {!item.confirmed && " (sin confirmar)"}
                  </span>
                </div>
                {/* Sección 14.5.C del encargo - modelo/familia/serie/contrato
                    por equipo (Sección 14 del encargo NEXUS V3 After-Hours).
                    Mismo fallback "—"/"Modelo no identificado" que el resto
                    del Explorador (formatModelCell, reutilizado tal cual). */}
                <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
                  <Field label="Modelo" value={formatModelCell(item.model, { model_resolution_status: item.modelResolutionStatus })} />
                  <Field label="Familia" value={item.equipmentFamily ?? "—"} />
                  <Field label="N.º de serie" value={item.serialNumbers.length > 0 ? item.serialNumbers.join(" / ") : "—"} />
                  <Field
                    label="Contrato relacionado"
                    value={
                      item.contracts.length === 0
                        ? "Sin contrato vigente vinculado"
                        : item.contracts.map((c: FieldbeatContractRelation) => `${contractStatusLabel(c.statusCode)} · ${spaTierLabel(c.spaTierCode)}`).join(" / ")
                    }
                  />
                </dl>
                {item.contracts.length > 0 && (
                  <div className="mt-2 flex flex-col gap-2">
                    {item.contracts.map((c: FieldbeatContractRelation) => (
                      <ContractCoverageScheduleView key={c.contractVersionId} result={c.schedule} appliedSource={contractAppliedSource(afterHoursContext)} />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {hasCapability(capabilities ?? [], "correction:equipment-identification") && (
          <div className="mt-2">
            <EquipmentIdentificationCorrectionAction
              fieldbeatTaskId={data.report.fieldbeatTaskId}
              rawEquipmentReference={data.equipment.rawEquipmentReference}
              onCorrected={retry}
            />
          </div>
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
              <li key={p.lineId} className="rounded-[var(--nx-radius-card)] border p-2.5" style={{ borderColor: "var(--nx-border)" }}>
                <div className="flex items-center justify-between">
                  {/* HOTFIX de integridad de datos: rawName y rawPartNumber
                      SIEMPRE ambos visibles - el número de parte real NUNCA
                      se oculta detrás del nombre (bug real que motivó este
                      hotfix: reporte 3453, "CX1551G" nunca aparecía). */}
                  <span className="text-[13px] font-semibold" style={{ color: "var(--nx-text-primary)" }}>
                    {p.rawName ?? "Sin descripción"}
                  </span>
                  <span className="text-[11.5px]" style={{ color: "var(--nx-text-secondary)" }}>
                    Cant.: {p.quantity === null ? "Sin registrar" : p.quantity}
                  </span>
                </div>
                <p className="text-[12px] font-mono" style={{ color: "var(--nx-text-secondary)" }}>
                  N° de parte: {p.rawPartNumber ?? "Sin número declarado"}
                </p>
                <p className="text-[12px]" style={{ color: "var(--nx-text-secondary)" }} title={p.explanation}>
                  {CATALOG_MATCH_STATUS_LABEL[p.catalogMatchStatus] ?? p.catalogMatchStatus}
                  {p.matchedSku && ` · ${p.matchedSku}`}
                </p>
                {(p.sourceLocation || p.sourceComment) && (
                  <p className="text-[11.5px]" style={{ color: "var(--nx-text-secondary)" }}>
                    Origen: {p.sourceLocation ?? "Sin información"}
                    {p.sourceComment && ` — ${p.sourceComment}`}
                  </p>
                )}
                {p.matchEvidence.kind === "AMBIGUOUS_CANDIDATES" && (
                  <p className="text-[11.5px] italic" style={{ color: "var(--nx-warning-fg, #8a5a00)" }}>
                    Candidatos (sin confirmar): {p.matchEvidence.candidateProductIds.join(", ")}
                  </p>
                )}
                {p.matchEvidence.kind === "HISTORICAL_ALIAS" && (
                  <p className="text-[11.5px] italic" style={{ color: "var(--nx-text-secondary)" }}>
                    Alias histórico: {p.matchEvidence.aliasValue}
                    {p.matchEvidence.reason && ` (${p.matchEvidence.reason})`}
                  </p>
                )}
                {p.attachment && (
                  <p className="text-[11.5px] italic" style={{ color: "var(--nx-text-secondary)" }}>
                    Adjunto: {p.attachment.filename} {!p.attachment.bytesAvailable && "(no disponible en el dataset local)"}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 8b. Incidencias de gobierno (Sección 14.5.F del encargo NEXUS V3
          After-Hours) - governance.issues corre en una query aparte (pool
          de gobierno, ver fetchReportActiveIssues) y puede degradar a
          "unavailable" sin tumbar el resto del detalle; se distingue
          explícitamente de "confirmado, cero incidencias" (nunca la misma
          UI para ambos casos). */}
      <Section title="Incidencias">
        {data.issues.status === "unavailable" ? (
          <p className="text-[13px]" style={{ color: "var(--nx-warning-fg, #8a5a00)" }}>
            No fue posible verificar incidencias activas - intenta más tarde.
          </p>
        ) : data.issues.issues.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--nx-text-secondary)" }}>
            Sin incidencias activas.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {data.issues.issues.map(issue => (
              <li key={issue.id} className="flex items-center justify-between rounded-[var(--nx-radius-chip)] border px-2.5 py-1.5" style={{ borderColor: "var(--nx-border)" }}>
                <span className="text-[13px]" style={{ color: "var(--nx-text-primary)" }}>
                  {issue.ruleCode}
                </span>
                <SeverityBadge severity={issue.severity} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 8c/8d. Tiempos del reporte / Resolución contractual - EXCLUSIVOS de
          After-Hours (Sección 14.5.D/E del encargo), compuestos en el
          cliente desde la fila ya cargada por la tabla (ver
          lib/after-hours-detail-view.ts::buildAfterHoursDrawerContext).
          Nunca se renderizan para Explorador/Búsqueda/FieldBeat Calidad
          (afterHoursContext queda undefined/null ahí). */}
      {afterHoursContext && (
        <>
          <Section title="Tiempos del reporte">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
              <Field label="Hora de inicio" value={afterHoursContext.startTime} />
              <Field label="Hora de término" value={afterHoursContext.endTime} />
              <Field label="Duración total" value={afterHoursContext.durationLabel} />
              <Field label="Tiempo cubierto" value={afterHoursContext.coveredTimeLabel} />
              <Field label="Tiempo fuera de cobertura" value={afterHoursContext.uncoveredTimeLabel} />
              <Field label="· Día hábil fuera de horario" value={afterHoursContext.weekdayAfterHoursLabel} />
              <Field label="· Fin de semana" value={afterHoursContext.weekendLabel} />
              <Field label="· Feriado" value={afterHoursContext.holidayLabel} />
            </dl>
          </Section>

          <Section title="Resolución contractual">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
              <Field label="Base de cálculo" value={afterHoursContext.dataBasis.label} />
              <Field label="Clasificación" value={afterHoursContext.coverage.label} />
              <Field label="Motivo final" value={afterHoursContext.finalReason.label} />
              {afterHoursContext.contractualReason && <Field label="Motivo contractual" value={afterHoursContext.contractualReason.label} />}
              <Field label="Horario de respaldo" value={afterHoursContext.fallback.label} />
              {/* Confianza del intervalo temporal y confianza de la
                  resolución contractual se mantienen DIFERENCIADAS (Sección
                  14.5.E del encargo) - nunca una etiqueta genérica única. */}
              <Field label="Confianza temporal" value={afterHoursContext.temporalConfidenceText} />
              {afterHoursContext.contractualConfidenceText && <Field label="Confianza contractual" value={afterHoursContext.contractualConfidenceText} />}
            </dl>
            <p className="text-[13px]" style={{ color: "var(--nx-text-secondary)" }}>
              {afterHoursContext.finalReason.description}
            </p>
          </Section>
        </>
      )}

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
