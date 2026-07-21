import { FieldbeatSegmentedBar } from "./FieldbeatSegmentedBar";
import type { FieldbeatPartsPresenceViewModel } from "@/lib/fieldbeat-metrics";

interface FieldbeatPartsPresenceProps {
  presence: FieldbeatPartsPresenceViewModel;
}

// Tarjeta secundaria "Presencia de repuesto en el reporte" del mockup - 2
// segmentos (con repuesto / sin repuesto) que suman total_fieldbeat_reports.
export function FieldbeatPartsPresence({ presence }: FieldbeatPartsPresenceProps) {
  return (
    <FieldbeatSegmentedBar
      title="Presencia de repuesto en el reporte"
      total={presence.totalReports}
      segments={[
        { label: "Con repuesto registrado", value: presence.withParts, color: "var(--nx-accent-purple)" },
        { label: "Sin repuesto registrado", value: presence.withoutParts, color: "var(--nx-border)" }
      ]}
    />
  );
}
