import type { HomeLastClientState } from "./home.types";
import { formatDateTimeEsCl } from "@/lib/dashboard-formatters";
// Se compone con HomeLastClientState (no status/clientName
// independientes). `fullWidth` la controla el padre (HomeDashboard) según
// si hay ítems de atención en la misma fila (ver layout responsive).
type HomeLastClientProps = HomeLastClientState & {
  fullWidth: boolean;
};

// Nota de reutilización: EmptyState (components/ui/EmptyState.tsx) NO se
// usa acá pese a que el plan lo proponía - su estilo da por sentada una
// tarjeta clara (colores --text-secondary/--text-muted, mapeados a
// --eyg-ink/--eyg-muted, oscuros). Esta tarjeta reutiliza --nx-sidebar-bg
// (fondo oscuro) para diferenciarla visualmente, como en el mockup -
// forzar EmptyState sobre ese fondo dejaría texto oscuro sobre fondo
// oscuro, un defecto de contraste real, no cosmético. Se renderiza el
// mensaje directamente con los tokens --nx-sidebar-text-* en su lugar.
export function HomeLastClient(props: HomeLastClientProps) {
  return (
    <div
      className={`flex min-w-0 flex-col justify-center gap-1.5 rounded-[var(--nx-radius-card)] p-4 ${
        props.fullWidth ? "lg:flex-row lg:items-center lg:justify-between lg:gap-4" : ""
      }`}
      style={{ background: "var(--nx-sidebar-bg)" }}
      aria-busy={props.status === "loading"}
    >
      <h2 className="text-[13px] font-semibold" style={{ color: "var(--nx-sidebar-text-secondary)" }}>
        Último cliente atendido
      </h2>

      <div className="min-w-0 flex-1">
        {props.status === "loading" && (
          <div
            aria-hidden="true"
            className="h-6 w-40 rounded-[var(--nx-radius-chip)]"
            style={{ background: "rgba(255,255,255,0.12)", animation: "nx-pulse 1.6s ease-in-out infinite" }}
          />
        )}

        {props.status === "error" && (
          <p className="text-sm font-semibold" style={{ color: "var(--nx-sidebar-text-secondary)" }}>
            No se pudo cargar esta información
          </p>
        )}

        {props.status === "success" && props.clientName === null && (
          <p className="text-sm font-semibold" style={{ color: "var(--nx-sidebar-text-secondary)" }}>
            Información todavía no disponible
          </p>
        )}

        {props.status === "success" && props.clientName !== null && (
            <>
              <p
                className="break-words text-lg font-extrabold"
                style={{ color: "var(--nx-sidebar-text-primary)" }}
              >
                {props.clientName}
              </p>

              <p
                className="text-xs"
                style={{ color: "var(--nx-sidebar-text-secondary)" }}
              >
                {props.activityDate
                  ? `Última actividad: ${formatDateTimeEsCl(props.activityDate)}`
                  : "Fecha de actividad no disponible."}
              </p>
            </>
          )}
      </div>
    </div>
  );
}
