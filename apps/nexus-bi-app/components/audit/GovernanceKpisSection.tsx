"use client";

import { useEffect, useState } from "react";
import { StatusBadge, severityBadge, issueStatusBadge } from "@/components/ui/StatusBadge";
import { entityTypeLabel, correctionTypeLabel, actorTypeLabel } from "@/lib/audit-vocabulary";
import { useDataRefreshEpoch } from "@/components/data-refresh/DataRefreshEpochProvider";

interface KpisResponse {
  byStatus: Array<{ status: string; n: string }>;
  bySeverity: Array<{ severity: string; n: string }>;
  byRule: Array<{ rule_code: string; rule_title: string; n: string }>;
  byEntityType: Array<{ entity_type: string; n: string }>;
  verification: Array<{ processing_status: string; verification_outcome: string | null; n: string }>;
  recentCorrections: Array<{ id: string; correction_type: string; target_type: string; actor_type: string; reason: string; created_at: string }>;
  dailyDetections: Array<{ day: string; n: string }>;
}

interface GovernanceKpisSectionProps {
  // Navega a Bandeja (tab=inbox) con filtros pre-aplicados - "contexto antes
  // que KPI aislado": ningún número de esta pestaña es un callejón sin
  // salida, siempre lleva al backlog real que lo explica.
  onNavigateToInbox: (filters?: Record<string, string>) => void;
}

const SEVERITY_BAR_COLOR: Record<string, string> = {
  HIGH: "var(--nx-danger-fg)",
  MEDIUM: "var(--nx-warning-border)",
  WARNING: "var(--nx-warning-border)",
  LOW: "var(--nx-accent-indigo)"
};

function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

// Tarjeta hero (Etapa dataviz "elegir la forma": un número solo, no un
// gráfico, cuando el trabajo es un titular) - la única incidencia
// "totalizadora" que se enfatiza a propósito (principio "excepción antes
// que volumen": el resto de las tarjetas mide EXCEPCIONES sobre ese total,
// nunca el total mismo repetido con otro nombre).
function HeroCard({ label, value, subtext, onClick }: { label: string; value: number; subtext: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-1 rounded-[var(--nx-radius-card)] p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{ background: "var(--nx-sidebar-bg)", boxShadow: "var(--nx-shadow-card-dark, var(--nx-shadow-shell))", outlineColor: "var(--nx-focus-ring-color)" }}
    >
      <span className="text-xs font-semibold" style={{ color: "var(--nx-sidebar-text-secondary)" }}>
        {label}
      </span>
      <span className="tabular-nums text-3xl font-extrabold" style={{ color: "var(--nx-sidebar-text-primary)" }}>
        {value.toLocaleString("es-CL")}
      </span>
      <span className="text-xs" style={{ color: "var(--nx-sidebar-text-secondary)" }}>
        {subtext}
      </span>
    </button>
  );
}

function ExceptionCard({
  label,
  value,
  tone,
  onClick
}: {
  label: string;
  value: number;
  tone: "danger" | "warning";
  onClick: () => void;
}) {
  const borderColor = tone === "danger" ? "var(--nx-danger-fg)" : "var(--nx-warning-border)";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-1 rounded-[var(--nx-radius-card)] p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)", borderTop: `3px solid ${borderColor}`, outlineColor: "var(--nx-focus-ring-color)" }}
    >
      <span className="text-xs font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
        {label}
      </span>
      <span className="tabular-nums text-2xl font-extrabold" style={{ color: "var(--nx-text-primary)" }}>
        {value.toLocaleString("es-CL")}
      </span>
    </button>
  );
}

// Contexto de ciclo de vida (Abierta/En revisión/Resuelta/Descartada) -
// deliberadamente con menos peso visual que las tarjetas de arriba: son
// volumen/estado, no la excepción que amerita atención inmediata.
function MiniStat({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-0.5 rounded-[var(--nx-radius-card)] px-3.5 py-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)", outlineColor: "var(--nx-focus-ring-color)" }}
    >
      <span className="text-xs" style={{ color: "var(--nx-text-secondary)" }}>
        {label}
      </span>
      <span className="tabular-nums text-lg font-bold" style={{ color: "var(--nx-text-primary)" }}>
        {value.toLocaleString("es-CL")}
      </span>
    </button>
  );
}

function ChartCard({ question, subtitle, children }: { question: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--nx-radius-card)] p-4" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}>
      <div className="text-sm font-bold" style={{ color: "var(--nx-text-primary)" }}>
        {question}
      </div>
      <div className="mb-3 text-xs" style={{ color: "var(--nx-text-secondary)" }}>
        {subtitle}
      </div>
      {children}
    </div>
  );
}

// Fila de barra horizontal - cada fila lleva su propio valor directo (nunca
// un gráfico con puntos sin etiquetar), es un <button> completo para que el
// filtro sea alcanzable por teclado (WCAG 2.1.1), y usa un único hue por
// gráfico (magnitud/ranking, no identidad categórica - dataviz skill
// "Sequential = one hue").
function BarRow({ label, value, total, color, onClick }: { label: string; value: number; total: number; color: string; onClick: () => void }) {
  const width = pct(value, total);
  return (
    <button type="button" onClick={onClick} className="mb-2.5 block w-full text-left last:mb-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ outlineColor: "var(--nx-focus-ring-color)" }}>
      <div className="mb-1 flex items-center justify-between gap-2 text-sm" style={{ color: "var(--nx-text-primary)" }}>
        <span className="truncate-title">{label}</span>
        <span className="tabular-nums shrink-0 font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
          {value.toLocaleString("es-CL")} · {width}%
        </span>
      </div>
      <div className="h-2.5 rounded-full" style={{ background: "var(--nx-page-bg)" }}>
        <div className="h-full rounded-full" style={{ width: `${width}%`, background: color }} />
      </div>
    </button>
  );
}

// Gate B - Familia 8: pestaña "Resumen" - KPIs de gobierno reales
// (governance.issues/verification_requests/correction_versions). Cada
// widget viene de GET /api/audit/kpis (una consulta real por widget) -
// nunca se inventa un gráfico/tendencia sin datos que lo respalden; si un
// widget no tiene datos, muestra su propio estado vacío, nunca se oculta en
// silencio. Composición sigue el patrón de docs/design-revolution/Nexus -
// Auditoria.dc.html (hero + tarjetas de excepción + gráficos "pregunta como
// título") y el dataviz skill (forma antes que color, un hue por gráfico de
// magnitud, colores de severidad reservados y consistentes con StatusBadge).
export function GovernanceKpisSection({ onNavigateToInbox }: GovernanceKpisSectionProps) {
  const epoch = useDataRefreshEpoch();
  const [data, setData] = useState<KpisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch("/api/audit/kpis")
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw body;
        setData(body);
      })
      .catch(body => setError(body?.error ?? "Error desconocido"))
      .finally(() => setLoading(false));
  }, [epoch]);

  if (loading) return <p style={{ color: "var(--nx-text-secondary)" }}>Cargando…</p>;
  if (error) return <p style={{ color: "var(--nx-danger-fg, #c0392b)" }}>{error}</p>;
  if (!data) return null;

  const statusMap = Object.fromEntries(data.byStatus.map(row => [row.status, Number(row.n)]));
  const openCount = statusMap.OPEN ?? 0;
  const inReviewCount = statusMap.IN_REVIEW ?? 0;
  const resolvedCount = statusMap.RESOLVED ?? 0;
  const dismissedCount = statusMap.DISMISSED ?? 0;
  const totalAll = openCount + inReviewCount + resolvedCount + dismissedCount;
  const openInReviewTotal = openCount + inReviewCount;

  const verificationMap = new Map<string, number>();
  for (const row of data.verification) {
    const key = row.verification_outcome ?? row.processing_status;
    verificationMap.set(key, (verificationMap.get(key) ?? 0) + Number(row.n));
  }
  const pendingCount = data.verification
    .filter(row => row.processing_status === "PENDING" || row.processing_status === "RUNNING")
    .reduce((sum, row) => sum + Number(row.n), 0);
  const stillDetectedCount = verificationMap.get("STILL_DETECTED") ?? 0;
  const deadLetterCount = data.verification
    .filter(row => row.processing_status === "DEAD_LETTERED")
    .reduce((sum, row) => sum + Number(row.n), 0);

  const dailyMax = Math.max(1, ...data.dailyDetections.map(row => Number(row.n)));
  const last14Days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    return d.toISOString().slice(0, 10);
  });
  const dailyMap = new Map(data.dailyDetections.map(row => [new Date(row.day).toISOString().slice(0, 10), Number(row.n)]));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <HeroCard
          label="Incidencias abiertas o en revisión"
          value={openInReviewTotal}
          subtext={`${pct(openInReviewTotal, totalAll)}% de ${totalAll.toLocaleString("es-CL")} detectadas en total`}
          onClick={() => onNavigateToInbox()}
        />
        <ExceptionCard label="Verificaciones pendientes" value={pendingCount} tone="warning" onClick={() => onNavigateToInbox({ verification: "pending" })} />
        <ExceptionCard label="Aún detectadas tras corrección" value={stillDetectedCount} tone="danger" onClick={() => onNavigateToInbox({ verification: "still_detected" })} />
        <ExceptionCard label="Con error operacional" value={deadLetterCount} tone="danger" onClick={() => onNavigateToInbox({ verification: "dead_letter" })} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label={issueStatusBadge("OPEN").label} value={openCount} onClick={() => onNavigateToInbox({ status: "OPEN" })} />
        <MiniStat label={issueStatusBadge("IN_REVIEW").label} value={inReviewCount} onClick={() => onNavigateToInbox({ status: "IN_REVIEW" })} />
        <MiniStat label={issueStatusBadge("RESOLVED").label} value={resolvedCount} onClick={() => onNavigateToInbox({ status: "RESOLVED" })} />
        <MiniStat label={issueStatusBadge("DISMISSED").label} value={dismissedCount} onClick={() => onNavigateToInbox({ status: "DISMISSED" })} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard question="¿Qué problemas aparecen con mayor frecuencia?" subtitle={`${openInReviewTotal.toLocaleString("es-CL")} incidencias abiertas o en revisión, por regla`}>
          {data.byRule.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--nx-text-secondary)" }}>
              Sin incidencias abiertas.
            </p>
          ) : (
            data.byRule.map(row => (
              <BarRow
                key={row.rule_code}
                label={row.rule_title}
                value={Number(row.n)}
                total={openInReviewTotal}
                color="var(--nx-accent-indigo)"
                onClick={() => onNavigateToInbox({ ruleCode: row.rule_code })}
              />
            ))
          )}
        </ChartCard>

        <ChartCard question="¿Qué impacto tiene cada problema?" subtitle="Incidencias abiertas o en revisión, por severidad">
          {data.bySeverity.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--nx-text-secondary)" }}>
              Sin incidencias abiertas.
            </p>
          ) : (
            data.bySeverity.map(row => (
              <BarRow
                key={row.severity}
                label={severityBadge(row.severity).label}
                value={Number(row.n)}
                total={openInReviewTotal}
                color={SEVERITY_BAR_COLOR[row.severity] ?? "var(--nx-accent-indigo)"}
                onClick={() => onNavigateToInbox({ severity: row.severity })}
              />
            ))
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard question="¿De qué tipo de entidad provienen?" subtitle="Incidencias abiertas o en revisión, por tipo de entidad">
          {data.byEntityType.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--nx-text-secondary)" }}>
              Sin incidencias abiertas.
            </p>
          ) : (
            data.byEntityType.map(row => (
              <BarRow
                key={row.entity_type}
                label={entityTypeLabel(row.entity_type)}
                value={Number(row.n)}
                total={openInReviewTotal}
                color="var(--nx-accent-purple)"
                onClick={() => onNavigateToInbox({ entityType: row.entity_type })}
              />
            ))
          )}
        </ChartCard>

        <ChartCard question="¿Cómo evolucionó la detección en los últimos 14 días?" subtitle="Incidencias nuevas por día de primera detección">
          {data.dailyDetections.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--nx-text-secondary)" }}>
              Sin detecciones en los últimos 14 días.
            </p>
          ) : (
            <div className="flex h-28 items-end gap-1">
              {last14Days.map(day => {
                const n = dailyMap.get(day) ?? 0;
                const height = Math.max(2, Math.round((n / dailyMax) * 100));
                return (
                  <div
                    key={day}
                    role="img"
                    aria-label={`${new Date(day).toLocaleDateString("es-CL")}: ${n} incidencia${n === 1 ? "" : "s"} nueva${n === 1 ? "" : "s"}`}
                    title={`${new Date(day).toLocaleDateString("es-CL")}: ${n}`}
                    className="flex-1 rounded-t-sm"
                    style={{ height: `${height}%`, background: n > 0 ? "var(--nx-accent-indigo)" : "var(--nx-border)" }}
                  />
                );
              })}
            </div>
          )}
        </ChartCard>
      </div>

      <div className="rounded-[var(--nx-radius-card)] p-3.5" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}>
        <div className="mb-2 text-xs font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
          Correcciones recientes
        </div>
        {data.recentCorrections.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--nx-text-secondary)" }}>
            Sin correcciones registradas todavía.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {data.recentCorrections.map(row => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-1.5" style={{ borderColor: "var(--nx-border)" }}>
                <span className="flex items-center gap-2">
                  <span style={{ color: "var(--nx-text-primary)" }}>{correctionTypeLabel(row.correction_type)}</span>
                  <StatusBadge label={actorTypeLabel(row.actor_type)} tone="neutral" size="sm" />
                </span>
                <span style={{ color: "var(--nx-text-secondary)" }}>{new Date(row.created_at).toLocaleString("es-CL")}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
