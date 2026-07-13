import { formatNumberEsCl } from "@/lib/dashboard-formatters";

interface MiniBarTableCellProps {
  value: number;
  max: number;
}

// Barra mini proporcional dentro de una celda de tabla ("Cantidad
// consumida" de la tabla de repuestos), migrada a tokens --nx-*.
export function MiniBarTableCell({ value, max }: MiniBarTableCellProps) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;

  return (
    <span className="inline-flex items-center gap-2" style={{ fontVariantNumeric: "tabular-nums" }}>
      <span
        className="inline-block h-4 w-[100px] overflow-hidden rounded"
        style={{ background: "var(--nx-page-bg)" }}
      >
        <span className="block h-full" style={{ width: `${pct}%`, background: "var(--nx-accent-indigo)" }} />
      </span>
      {formatNumberEsCl(value)}
    </span>
  );
}
