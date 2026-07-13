"use client";

import { useEffect, useState } from "react";
import {
  type AfterHoursSummaryData,
  type AuditSummaryData,
  type FieldbeatSummaryData,
  type HomeAreaStatusOf,
  type HomeAreaStatusTuple,
  type HomeAttentionItem,
  type HomeKpiAccent,
  type HomeKpiKey,
  type HomeKpiOf,
  type HomeKpiTuple,
  type HomeLastClientState,
  type OperacionalSummaryData,
  type RemoteData,
  isAfterHoursSummaryData,
  isAuditSummaryData,
  isFieldbeatSummaryData,
  isOperacionalSummaryData
} from "./home.types";
import { formatWholeNumber, normalizeClientName } from "./home.utils";
import { HomeSummaryGrid } from "./HomeSummaryGrid";
import { HomeAttentionPanel } from "./HomeAttentionPanel";
import { HomeLastClient } from "./HomeLastClient";
import { HomeDataStatus } from "./HomeDataStatus";

// Único límite "use client" de la página. Dueño de las 4 llamadas fetch
// independientes (audit, operacional, fieldbeat, after-hours) y de
// proyectar cada RemoteData<T> crudo a la forma de presentación que cada
// componente hoja necesita. Sin estado global nuevo: todo vive acá, en
// useState local.
function useRemoteData<T>(url: string, validate: (value: unknown) => value is T): RemoteData<T> {
  const [state, setState] = useState<RemoteData<T>>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });

    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body: unknown = await res.json();
        if (!validate(body)) throw new Error("contrato inesperado");
        setState({ status: "success", data: body });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({ status: "error" });
      });

    return () => controller.abort();
  }, [url, validate]);

  return state;
}

function toKpi<T, K extends HomeKpiKey>(
  source: RemoteData<T>,
  key: K,
  label: string,
  accent: HomeKpiAccent,
  pick: (data: T) => number
): HomeKpiOf<K> {
  if (source.status === "success") return { status: "success", value: pick(source.data), key, label, accent };
  if (source.status === "loading") return { status: "loading", key, label, accent };
  return { status: "error", key, label, accent };
}

function toLastClientState(source: RemoteData<OperacionalSummaryData>): HomeLastClientState {
  if (source.status === "success") {
    return { status: "success", clientName: normalizeClientName(source.data.kpis.ultimoCliente) };
  }
  if (source.status === "loading") return { status: "loading" };
  return { status: "error" };
}

function deriveOperacionalStatus(source: RemoteData<OperacionalSummaryData>): HomeAreaStatusOf<"operacional"> {
  const label = "Dashboard Operacional";
  if (source.status === "loading") return { area: "operacional", label, status: "loading" };
  if (source.status === "error") return { area: "operacional", label, status: "failed" };
  return { area: "operacional", label, status: source.data.kpis.totalRegistros === 0 ? "empty" : "success" };
}

function deriveFieldbeatStatus(source: RemoteData<FieldbeatSummaryData>): HomeAreaStatusOf<"fieldbeat"> {
  const label = "FieldBeat";
  if (source.status === "loading") return { area: "fieldbeat", label, status: "loading" };
  if (source.status === "error") return { area: "fieldbeat", label, status: "failed" };
  return { area: "fieldbeat", label, status: source.data.kpis === null ? "empty" : "success" };
}

function deriveAfterHoursStatus(source: RemoteData<AfterHoursSummaryData>): HomeAreaStatusOf<"afterHours"> {
  const label = "Trabajo fuera de horario";
  if (source.status === "loading") return { area: "afterHours", label, status: "loading" };
  if (source.status === "error") return { area: "afterHours", label, status: "failed" };
  const incomplete = source.data.businessHoursStatus === "MISSING" || source.data.holidaysStatus === "MISSING";
  return { area: "afterHours", label, status: incomplete ? "stale" : "success" };
}

function deriveAuditoriaStatus(source: RemoteData<AuditSummaryData>): HomeAreaStatusOf<"auditoria"> {
  const label = "Auditoría";
  if (source.status === "loading") return { area: "auditoria", label, status: "loading" };
  if (source.status === "error") return { area: "auditoria", label, status: "failed" };
  return { area: "auditoria", label, status: source.data.reportsReviewRequired > 0 ? "needs-review" : "success" };
}

// Ítems de atención: solo se llama una vez ambas fuentes (audit,
// after-hours) están asentadas (ver `attentionLoading` en el render) -
// un fallo técnico de cualquiera de las dos nunca genera un ítem acá
// (eso se refleja en HomeDataStatus, no como alerta de negocio).
function computeAttentionItems(
  auditState: RemoteData<AuditSummaryData>,
  afterHoursState: RemoteData<AfterHoursSummaryData>
): HomeAttentionItem[] {
  const items: HomeAttentionItem[] = [];

  if (auditState.status === "success" && auditState.data.reportsReviewRequired > 0) {
    items.push({
      id: "audit-review-required",
      message: `${formatWholeNumber(auditState.data.reportsReviewRequired)} registros requieren revisión en Auditoría.`,
      tone: "warning"
    });
  }

  if (
    afterHoursState.status === "success" &&
    (afterHoursState.data.businessHoursStatus === "MISSING" || afterHoursState.data.holidaysStatus === "MISSING")
  ) {
    items.push({
      id: "after-hours-config-pending",
      message: "La configuración de horarios y feriados está pendiente en Trabajo fuera de horario.",
      tone: "warning"
    });
  }

  return items;
}

interface HomeDashboardProps {
  // Slot para HomeNavigationGrid (Server Component, sin datos). Se recibe
  // como children ya renderizado desde app/page.tsx (Server Component) en
  // vez de importarlo/instanciarlo acá - el contenido de un Server
  // Component pasado como children a un Client Component permanece
  // server-rendered, no se convierte en cliente por estar "dentro" de
  // HomeDashboard. Existe únicamente para poder intercalarlo en el orden
  // visual correcto (Resumen general -> Accesos principales -> ...), que
  // no coincide con el orden de montaje en app/page.tsx.
  navigationSlot: React.ReactNode;
}

export function HomeDashboard({ navigationSlot }: HomeDashboardProps) {
  const auditState = useRemoteData<AuditSummaryData>("/api/audit/summary", isAuditSummaryData);
  const operacionalState = useRemoteData<OperacionalSummaryData>(
    "/api/dashboard/operacional/summary",
    isOperacionalSummaryData
  );
  const fieldbeatState = useRemoteData<FieldbeatSummaryData>("/api/dashboard/fieldbeat", isFieldbeatSummaryData);
  const afterHoursState = useRemoteData<AfterHoursSummaryData>(
    "/api/dashboard/after-hours/summary",
    isAfterHoursSummaryData
  );

  const kpis: HomeKpiTuple = [
    toKpi(auditState, "reportesTotales", "Reportes totales", "green", data => data.totalFieldbeatReports),
    toKpi(operacionalState, "tickets", "Tickets", "indigo", data => data.kpis.totalTickets),
    toKpi(
      auditState,
      "repuestosUtilizados",
      "Repuestos utilizados",
      "purple",
      data => data.partsMatched + data.partsUnmatched + data.partsAmbiguous + data.partsPlaceholder
    ),
    toKpi(auditState, "requierenRevision", "Requieren revisión", "amber", data => data.reportsReviewRequired)
  ];

  const areas: HomeAreaStatusTuple = [
    deriveOperacionalStatus(operacionalState),
    deriveFieldbeatStatus(fieldbeatState),
    deriveAfterHoursStatus(afterHoursState),
    deriveAuditoriaStatus(auditState)
  ];

  const lastClient = toLastClientState(operacionalState);

  // "Atención" depende de 2 fuentes (audit, after-hours) - mientras
  // cualquiera de las dos siga cargando, no se puede afirmar honestamente
  // que no hay ítems: se muestra un skeleton en vez de omitir la sección.
  const attentionLoading = auditState.status === "loading" || afterHoursState.status === "loading";
  const attentionItems = attentionLoading ? [] : computeAttentionItems(auditState, afterHoursState);
  const hasAttentionSlot = attentionLoading || attentionItems.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Una región role="status" por fuente, no por KPI - si audit falla
          y afecta a 3 tiles, se anuncia una sola vez. */}
      <div className="sr-only" role="status" aria-live="polite">
        {auditState.status === "error" ? "No se pudo cargar la información de Auditoría." : ""}
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {operacionalState.status === "error" ? "No se pudo cargar la información operacional." : ""}
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {fieldbeatState.status === "error" ? "No se pudo cargar la información de FieldBeat." : ""}
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {afterHoursState.status === "error" ? "No se pudo cargar la información de horario fuera de jornada." : ""}
      </div>

      <HomeSummaryGrid kpis={kpis} />

      {navigationSlot}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {attentionLoading && (
          <div
            aria-hidden="true"
            className="min-w-0 rounded-[var(--nx-radius-card)] p-4"
            style={{ background: "var(--nx-warning-bg)", opacity: 0.5, animation: "nx-pulse 1.6s ease-in-out infinite" }}
          />
        )}
        {!attentionLoading && attentionItems.length > 0 && <HomeAttentionPanel items={attentionItems} />}
        <div className={hasAttentionSlot ? "min-w-0" : "min-w-0 lg:col-span-2"}>
          <HomeLastClient {...lastClient} fullWidth={!hasAttentionSlot} />
        </div>
      </div>

      <HomeDataStatus areas={areas} />
    </div>
  );
}
