import { formatNumberEsCl } from "@/lib/dashboard-formatters";
import { percentLabel } from "@/lib/fieldbeat-metrics";

export interface FieldbeatSegment {
  label: string;
  value: number;
  color: string;
}

interface FieldbeatSegmentedBarProps {
  title: string;
  segments: readonly FieldbeatSegment[];
  total: number;
}

// Primitiva compartida (2 consumidores reales: FieldbeatTicketLinkage y
// FieldbeatPartsPresence - "dos adaptadores es un seam real",
// codebase-design) para el patrón "barra segmentada + leyenda" de las
// tarjetas secundarias del mockup. La barra es puramente decorativa
// (aria-hidden) - el color nunca es el único canal: cada segmento tiene su
// etiqueta, valor y porcentaje en texto visible en la leyenda.
export function FieldbeatSegmentedBar({ title, segments, total }: FieldbeatSegmentedBarProps) {
  return (
    <div className="rounded-xl p-3.5" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}>
      <div className="mb-2 text-[13.5px] font-bold" style={{ color: "var(--nx-text-primary)" }}>
        {title}
      </div>
      <div aria-hidden="true" className="mb-2 flex h-4 overflow-hidden rounded-[5px]">
        {segments.map(segment => (
          <div key={segment.label} style={{ width: `${total > 0 ? Math.max(0, (segment.value / total) * 100) : 0}%`, background: segment.color }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-1.5 gap-y-0.5 text-[13px]" style={{ color: "var(--nx-text-primary)" }}>
        {segments.map((segment, i) => (
          <li key={segment.label} className="flex items-center gap-1">
            {i > 0 && (
              <span aria-hidden="true" style={{ color: "var(--nx-text-muted)" }}>
                ·
              </span>
            )}
            <span>
              {segment.label} - {formatNumberEsCl(segment.value)} ({percentLabel(segment.value, total)})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
