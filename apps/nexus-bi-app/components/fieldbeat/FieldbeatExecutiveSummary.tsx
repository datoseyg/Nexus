import { FieldbeatKpiTile } from "./FieldbeatKpiTile";
import type { FieldbeatExecutiveSummaryViewModel } from "@/lib/fieldbeat-metrics";

interface FieldbeatExecutiveSummaryProps {
  summary: FieldbeatExecutiveSummaryViewModel;
  loading?: boolean;
}

// Grilla de 6 posiciones FIJAS, en el orden exacto del mockup (RESUMEN
// EJECUTIVO). No es una lista genérica de tiles - cada posición está
// nombrada explícitamente para que quede claro que 3 de las 6 son
// honestamente "no disponible" siempre, nunca sustituidas por otra
// métrica real (ver lib/fieldbeat-metrics.ts::buildExecutiveSummary).
export function FieldbeatExecutiveSummary({ summary, loading = false }: FieldbeatExecutiveSummaryProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-live="polite" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[92px] rounded-[var(--nx-radius-card)]" style={{ background: "var(--nx-page-bg)" }} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <FieldbeatKpiTile slot={summary.totalReports} />
      <FieldbeatKpiTile slot={summary.clientsWithActivity} />
      <FieldbeatKpiTile slot={summary.equipmentAttended} />
      <FieldbeatKpiTile slot={summary.predominantTaskType} />
      <FieldbeatKpiTile slot={summary.reportsWithParts} />
      <FieldbeatKpiTile slot={summary.recentActivity} />
    </div>
  );
}
