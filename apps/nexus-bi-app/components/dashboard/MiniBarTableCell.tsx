import styles from "./dashboard.module.css";

interface MiniBarTableCellProps {
  value: number;
  max: number;
}

// Barra mini proporcional dentro de una celda de tabla, tal como en la
// "Tabla Uso de Repuestos" del dashboard de referencia.
export function MiniBarTableCell({ value, max }: MiniBarTableCellProps) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span className={styles.barMini}>
        <span className={styles.barMiniFill} style={{ width: `${pct}%` }} />
      </span>
      {value}
    </span>
  );
}
