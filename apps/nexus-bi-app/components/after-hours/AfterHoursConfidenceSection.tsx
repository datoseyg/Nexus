"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AfterHoursSectionCard } from "./AfterHoursSectionCard";
import { AfterHoursEmptyBlock } from "./AfterHoursEmptyBlock";
import { getConfidenceTierLabel } from "@/lib/after-hours-labels";
import { afterHoursConfidenceScore, notCalculableConfidenceScore, overallConfidenceScore, showContractualConfidence } from "@/lib/after-hours-kpi-view";
import type { AfterHoursSummary, ConfidenceDistributionResponse } from "@/types/after-hours";

interface AfterHoursConfidenceSectionProps {
  summary: AfterHoursSummary;
  distribution: ConfidenceDistributionResponse | null;
}

const TIER_COLOR: Record<string, string> = {
  Insuficiente: "#d9534f",
  Baja: "#f4b740",
  Media: "var(--nx-accent-indigo)",
  Alta: "#1f6e46"
};

function SubMetric({ label, score, tierLabel }: { label: string; score: number | null; tierLabel: string }) {
  return (
    <div className="rounded-[10px] p-3.5" style={{ background: "var(--nx-page-bg)" }}>
      <div className="text-[13px]" style={{ color: "var(--nx-text-secondary)" }}>
        {label}
      </div>
      <div className="mt-0.5 text-[20px] font-extrabold" style={{ color: "var(--nx-text-primary)" }}>
        {score === null ? (
          "—"
        ) : (
          <>
            {score.toLocaleString("es-CL", { maximumFractionDigits: 1 })}{" "}
            <span className="text-[13px] font-bold" style={{ color: "var(--nx-accent-indigo)" }}>
              {tierLabel}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// "¿Qué tan confiable es este análisis?" (ETAPA 6.6D §10) - separa
// EXPLÍCITAMENTE confianza del intervalo temporal (confidence_score,
// escala metodológica de src/lib/calculation-confidence.js) de confianza
// de resolución contractual (contract_resolution_confidence, escala
// aditiva distinta, ETAPA 6.6B2) - nunca se mezclan en una sola
// distribución (§10: "Nunca mezcles ambas escalas en una sola
// distribución"). La segunda solo se muestra si hay al menos 1 tarea
// CONTRACTUAL.
export function AfterHoursConfidenceSection({ summary, distribution }: AfterHoursConfidenceSectionProps) {
  const overallTier = getConfidenceTierLabel(summary.kpis.totalHours.confidence_label || null);
  const afterHoursTier = getConfidenceTierLabel(summary.kpis.tasksWithAfterHours.confidence_label || null);

  const tierRows = distribution?.rows ?? [];
  const hasTierData = tierRows.some(r => r.task_count > 0);
  const noneWithoutScore = distribution?.noneWithoutScore ?? 0;

  const contractRows = distribution?.contractResolutionDistribution ?? [];
  const showContractual = showContractualConfidence(summary);

  return (
    <AfterHoursSectionCard question="¿Qué tan confiable es este análisis?" subtitle="Puntajes de confianza calculados sobre el análisis vigente">
      <div className="mb-3.5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SubMetric label="Confianza general" score={overallConfidenceScore(summary)} tierLabel={overallTier.label} />
        <SubMetric label="Tareas con horas fuera de horario" score={afterHoursConfidenceScore(summary)} tierLabel={afterHoursTier.label} />
        <SubMetric label="Tareas no calculables" score={notCalculableConfidenceScore(summary)} tierLabel="Alta" />
      </div>

      {summary.none_tasks > 0 && (
        <div className="mb-3.5 text-[13px]" style={{ color: "var(--nx-text-muted)" }}>
          {summary.none_tasks.toLocaleString("es-CL")} tareas no pudieron calcularse -el nivel de confianza no aplica para esos registros.
        </div>
      )}

      <div className="mb-2 text-[13.5px] font-bold" style={{ color: "var(--nx-text-primary)" }}>
        Confianza del intervalo temporal
      </div>
      {!hasTierData ? (
        <AfterHoursEmptyBlock
          title="Información todavía no disponible"
          description="La cantidad de registros por nivel (Alta, Media, Baja, Insuficiente) se mostrará cuando esté disponible."
        />
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={tierRows} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--nx-border)" />
            <XAxis dataKey="confidence_label" tick={{ fill: "var(--nx-text-secondary)", fontSize: 12 }} axisLine={{ stroke: "var(--nx-border)" }} tickLine={false} />
            <YAxis tick={{ fill: "var(--nx-text-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--nx-border)" }} tickLine={false} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: "var(--nx-page-bg)" }}
              contentStyle={{ background: "var(--nx-card-bg)", border: "1px solid var(--nx-border)", borderRadius: 8, fontSize: 12, color: "var(--nx-text-primary)" }}
              formatter={value => [value, "Tareas"]}
            />
            <Bar dataKey="task_count" radius={[4, 4, 0, 0]} maxBarSize={48}>
              {tierRows.map(entry => (
                <Cell key={entry.confidence_label} fill={TIER_COLOR[entry.confidence_label] ?? "var(--nx-accent-indigo)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      {noneWithoutScore > 0 && (
        <div className="mt-2 text-[13px]" style={{ color: "var(--nx-text-muted)" }}>
          {noneWithoutScore.toLocaleString("es-CL")} tareas sin información de confianza (no calculables desde el inicio) -no se clasifican como
          &ldquo;Insuficiente&rdquo;.
        </div>
      )}

      {showContractual && (
        <>
          <div className="mt-5 mb-2 text-[13.5px] font-bold" style={{ color: "var(--nx-text-primary)" }}>
            Confianza de resolución contractual
          </div>
          <div className="mb-2 text-[12.5px]" style={{ color: "var(--nx-text-muted)" }}>
            Escala distinta de la confianza del intervalo temporal - mide qué tan confiable fue el proceso de asociar la tarea a un contrato, solo
            para tareas con base de cálculo CONTRACTUAL ({summary.contractual_tasks.toLocaleString("es-CL")}).
          </div>
          {contractRows.length === 0 ? (
            <AfterHoursEmptyBlock title="Información todavía no disponible" />
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={contractRows} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--nx-border)" />
                <XAxis dataKey="contract_resolution_label" tick={{ fill: "var(--nx-text-secondary)", fontSize: 12 }} axisLine={{ stroke: "var(--nx-border)" }} tickLine={false} />
                <YAxis tick={{ fill: "var(--nx-text-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--nx-border)" }} tickLine={false} allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: "var(--nx-page-bg)" }}
                  contentStyle={{ background: "var(--nx-card-bg)", border: "1px solid var(--nx-border)", borderRadius: 8, fontSize: 12, color: "var(--nx-text-primary)" }}
                  formatter={value => [value, "Tareas"]}
                />
                <Bar dataKey="task_count" radius={[4, 4, 0, 0]} maxBarSize={48} fill="var(--nx-accent-purple)" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </>
      )}
    </AfterHoursSectionCard>
  );
}
