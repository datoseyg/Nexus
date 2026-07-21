import type { HomeKpiTuple } from "./home.types";
import { HomeMetricCard } from "./HomeMetricCard";

interface HomeSummaryGridProps {
  kpis: HomeKpiTuple;
}

// "Resumen general" - los 4 KPIs siempre visibles (2 columnas en móvil, 4
// en desktop, nunca ocultos). El <h2> es el marcador de humo de la ruta
// "/" (ver scripts/smoke.mjs): es texto estático, presente en el HTML
// servido por el servidor en cualquier estado de los 4 fetches, porque
// nunca depende de RemoteData - solo el contenido de cada tile depende.
export function HomeSummaryGrid({ kpis }: HomeSummaryGridProps) {
  const loading = kpis.some(kpi => kpi.status === "loading");

  return (
    <section aria-busy={loading}>
      <h2
        className="mb-2 text-xs font-bold uppercase tracking-wide"
        style={{ color: "var(--nx-text-muted)" }}
      >
        Resumen general
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(({ key, ...metric }) => (
          <HomeMetricCard key={key} {...metric} />
        ))}
      </div>
    </section>
  );
}
