import type { HomeAttentionItem } from "./home.types";

interface HomeAttentionPanelProps {
  items: readonly HomeAttentionItem[];
}

// El padre (HomeDashboard) decide si se monta: solo cuando hay al menos 1
// ítem real confirmado (ninguna bandera fija, ver reglas de derivación en
// HomeDashboard.tsx). Un error técnico de una fuente nunca genera un
// ítem acá - eso se refleja en HomeDataStatus, no como alerta de negocio.
// Tarjeta exterior BLANCA (igual que el resto de tarjetas de Inicio) que
// contiene filas individuales con fondo warning claro - no todo el panel
// en un solo rectángulo ámbar plano (el standalone usa esa composición:
// tarjeta blanca + filas #fdf3e0 dentro).
export function HomeAttentionPanel({ items }: HomeAttentionPanelProps) {
  return (
    <section
      className="min-w-0 rounded-[var(--nx-radius-card)] p-4"
      style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}
    >
      <h2 className="mb-3 text-[15.5px] font-bold" style={{ color: "var(--nx-text-primary)" }}>
        Elementos que requieren atención
      </h2>
      <ul className="flex flex-col gap-2">
        {items.map(item => (
          <li
            key={item.id}
            className="flex items-start gap-2.5 rounded-[var(--nx-radius-chip)] p-2.5 text-sm"
            style={{ background: "var(--nx-warning-bg)", color: "var(--nx-warning-fg)" }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="mt-0.5 shrink-0"
            >
              <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            </svg>
            <span className="break-words">{item.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
