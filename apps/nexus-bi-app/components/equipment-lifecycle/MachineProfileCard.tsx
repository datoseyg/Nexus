import type { MachineProfile } from "@/types/equipment-lifecycle";

interface MachineProfileCardProps {
  profile: MachineProfile | null;
  loading: boolean;
}

function round1(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return (Math.round(value * 10) / 10).toString();
}

function formatDate(value: string | null): string {
  return value ? value.slice(0, 10) : "-";
}

// Ficha de máquina (Parte 8.3): identificador, cliente, cantidad de
// reportes, repuestos observados, período observado, horas registradas.
export function MachineProfileCard({ profile, loading }: MachineProfileCardProps) {
  if (loading) {
    return (
      <div className="rounded-xl border p-4 text-sm" style={{ borderColor: "var(--eyg-border)", background: "var(--eyg-card)", color: "var(--text-secondary)" }}>
        Cargando ficha de máquina...
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="rounded-xl border p-4 text-sm" style={{ borderColor: "var(--eyg-border)", background: "var(--eyg-card)", color: "var(--text-secondary)" }}>
        Selecciona una máquina para ver su ficha, o navega la tabla de repuestos de todas las máquinas más abajo.
      </div>
    );
  }

  const items: Array<{ label: string; value: string }> = [
    { label: "Equipo", value: profile.equipment_internal_id },
    { label: "Cliente", value: profile.client_name ?? "-" },
    { label: "Reportes con repuestos", value: String(profile.reports_count) },
    { label: "Repuestos distintos observados", value: String(profile.parts_observed) },
    { label: "Período observado", value: `${formatDate(profile.first_event_date)} → ${formatDate(profile.last_event_date)}` },
    { label: "Horas hábiles registradas", value: profile.business_minutes_total !== null ? `${round1(profile.business_minutes_total / 60)} h` : "sin datos" },
    { label: "Horas fuera de horario registradas", value: profile.after_hours_minutes_total !== null ? `${round1(profile.after_hours_minutes_total / 60)} h` : "sin datos" }
  ];

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "var(--eyg-border)", background: "var(--eyg-card)" }}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map(item => (
          <div key={item.label}>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              {item.label}
            </div>
            <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
