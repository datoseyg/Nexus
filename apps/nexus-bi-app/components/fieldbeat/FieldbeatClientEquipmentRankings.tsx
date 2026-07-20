import { FieldbeatRankingCard } from "./FieldbeatRankingCard";
import type { FieldbeatRankingRow } from "@/lib/fieldbeat-ranking-view";

interface FieldbeatClientEquipmentRankingsProps {
  clientRows: FieldbeatRankingRow[];
  equipmentRows: FieldbeatRankingRow[];
  loading?: boolean;
}

// Sección "CLIENTES Y MÁQUINAS" del mockup - eyebrow + grilla de 2
// columnas (1 columna en móvil). Ranking equipos rotulado honestamente
// "Equipos con mayor uso de repuestos" (topEquipmentByParts ordena por
// used_parts_count, no por cantidad de reportes/atenciones).
export function FieldbeatClientEquipmentRankings({ clientRows, equipmentRows, loading = false }: FieldbeatClientEquipmentRankingsProps) {
  return (
    <div>
      <div className="mb-2 text-xs font-bold tracking-wide uppercase" style={{ color: "var(--nx-text-muted)" }}>
        Clientes y máquinas
      </div>
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <FieldbeatRankingCard
          title="¿Qué clientes concentran más reportes?"
          description="Top 10 clientes por reportes de terreno"
          rows={clientRows}
          loading={loading}
          barColor="var(--nx-accent-indigo)"
        />
        <FieldbeatRankingCard
          title="Equipos con mayor uso de repuestos"
          description="Top 10 equipos por repuestos utilizados"
          rows={equipmentRows}
          loading={loading}
          barColor="var(--nx-accent-green)"
        />
      </div>
    </div>
  );
}
