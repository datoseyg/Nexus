import { formatCompactNumber } from "@/lib/format";
import type { FieldbeatKpiSlot, FieldbeatKpiSlotAccent } from "@/lib/fieldbeat-metrics";

interface FieldbeatKpiTileProps {
  slot: FieldbeatKpiSlot;
}

// ETAPA 5-V - MetricCard (components/ui/MetricCard.tsx, mandatoria en
// ETAPA 5) no tiene variante de borde superior de color ni de tarjeta
// oscura - el mockup exige ambas (top border verde/púrpura, tile oscuro
// para "Actividad más reciente"). En vez de forzar esos dos tratamientos
// dentro de MetricCard (modificaría un componente compartido fuera de
// alcance), esta tarjeta es un componente nuevo, exclusivo de la grilla
// ejecutiva de FieldBeat, con tokens --nx-* únicamente.
const BORDER_TOP_COLOR: Record<FieldbeatKpiSlotAccent, string | undefined> = {
  green: "var(--nx-accent-green)",
  purple: "var(--nx-accent-purple)",
  dark: undefined,
  default: undefined
};

export function FieldbeatKpiTile({ slot }: FieldbeatKpiTileProps) {
  const isDark = slot.accent === "dark";

  return (
    <div
      className="min-w-0 rounded-[var(--nx-radius-card)] p-4"
      style={{
        background: isDark ? "var(--nx-sidebar-bg)" : "var(--nx-card-bg)",
        boxShadow: isDark ? "var(--nx-shadow-card-dark)" : "var(--nx-shadow-card)",
        borderTop: BORDER_TOP_COLOR[slot.accent] ? `3px solid ${BORDER_TOP_COLOR[slot.accent]}` : undefined
      }}
    >
      <div className="text-[13px]" style={{ color: isDark ? "var(--nx-sidebar-text-secondary)" : "var(--nx-text-secondary)" }}>
        {slot.label}
      </div>

      {slot.status === "available" ? (
        <>
          <div
            className="mt-0.5 truncate text-[27px] font-extrabold [font-variant-numeric:tabular-nums]"
            style={{ color: isDark ? "var(--nx-sidebar-text-primary)" : "var(--nx-text-primary)" }}
          >
            {formatCompactNumber(slot.value)}
          </div>
          {slot.hint && (
            <div className="mt-0.5 text-[13px]" style={{ color: isDark ? "var(--nx-sidebar-text-muted)" : "var(--nx-text-muted)" }}>
              {slot.hint}
            </div>
          )}
        </>
      ) : (
        <div className="mt-1 text-[15px] font-bold" style={{ color: isDark ? "var(--nx-sidebar-text-secondary)" : "var(--nx-text-muted)" }}>
          {slot.reason}
        </div>
      )}
    </div>
  );
}
