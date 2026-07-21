import { FieldbeatSegmentedBar } from "./FieldbeatSegmentedBar";
import type { FieldbeatTicketLinkageViewModel } from "@/lib/fieldbeat-metrics";

interface FieldbeatTicketLinkageProps {
  linkage: FieldbeatTicketLinkageViewModel;
}

// Tarjeta secundaria "Vinculación con tickets de soporte" del mockup. 3
// segmentos reales (no la simplificación a 2 del mockup) - revela la señal
// de "tickets fantasma" (missingOrRestricted) que una vista de solo 2
// categorías ocultaría; los 3 suman total_fieldbeat_reports (invariante
// #1, ver lib/fieldbeat-invariants.ts).
export function FieldbeatTicketLinkage({ linkage }: FieldbeatTicketLinkageProps) {
  return (
    <FieldbeatSegmentedBar
      title="Vinculación con tickets de soporte"
      total={linkage.totalReports}
      segments={[
        { label: "Vinculados a ticket accesible", value: linkage.accessible, color: "var(--nx-accent-indigo)" },
        { label: "Vinculados a ticket faltante o restringido", value: linkage.missingOrRestricted, color: "var(--nx-warning-border)" },
        { label: "Sin ticket asociado", value: linkage.noTicket, color: "var(--nx-border)" }
      ]}
    />
  );
}
