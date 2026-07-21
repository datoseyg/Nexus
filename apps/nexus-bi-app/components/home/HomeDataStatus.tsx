import type { HomeAreaStatus, HomeAreaStatusTuple } from "./home.types";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";

interface HomeDataStatusProps {
  areas: HomeAreaStatusTuple;
}

// Mapeo local hacia el contrato ya existente de StatusBadge (label+tone) -
// no se modifica StatusBadge.tsx para introducir los nombres internos de
// HomeAreaStatus. "loading" no tiene entrada acá: esa rama se renderiza
// como skeleton, nunca como StatusBadge (ver más abajo).
const STATUS_BADGE: Record<Exclude<HomeAreaStatus, "loading">, { label: string; tone: StatusTone }> = {
  success: { label: "Disponible", tone: "success" },
  "needs-review": { label: "Requiere revisión", tone: "warning" },
  // "stale" (configuración de horarios/feriados pendiente) usa tono
  // "info", no "warning" - es una nota de configuración, no una alerta de
  // incumplimiento laboral ni de horas extraordinarias.
  stale: { label: "Configuración incompleta", tone: "info" },
  empty: { label: "Sin información", tone: "neutral" },
  failed: { label: "No disponible", tone: "danger" }
};

// Superficie secundaria del standalone (#f7f8fb) para las filas internas -
// no existe un token --nx-* que represente exactamente este valor (el más
// cercano, --nx-page-bg, es #eef0f4, un tono distinto); se usa el literal
// local en vez de agregar un token global nuevo solo para esta corrección.
const ROW_BG = "#f7f8fb";

// "Estado de la información" - una sola tarjeta blanca exterior (igual
// que el standalone) con 4 filas internas #f7f8fb, cada una derivada de
// una condición real y verificable (ver HomeDashboard.tsx). Nunca
// truncado: nombres de área y etiquetas de estado envuelven en vez de
// cortarse.
export function HomeDataStatus({ areas }: HomeDataStatusProps) {
  const loading = areas.some(area => area.status === "loading");

  return (
    <section
      aria-busy={loading}
      className="rounded-[var(--nx-radius-card)] p-4"
      style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}
    >
      <h2 className="mb-3 text-[15.5px] font-bold" style={{ color: "var(--nx-text-primary)" }}>
        Estado de la información
      </h2>
      <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {areas.map(area => (
          <li
            key={area.area}
            className="flex min-w-0 flex-col gap-1.5 rounded-[var(--nx-radius-chip)] p-3"
            style={{ background: ROW_BG }}
          >
            <span className="break-words text-[13px] font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
              {area.label}
            </span>
            {area.status === "loading" ? (
              <span
                aria-hidden="true"
                className="h-5 w-24 rounded-[var(--nx-radius-chip)]"
                style={{ background: "var(--nx-border)", animation: "nx-pulse 1.6s ease-in-out infinite" }}
              />
            ) : (
              <span>
                <StatusBadge label={STATUS_BADGE[area.status].label} tone={STATUS_BADGE[area.status].tone} />
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
