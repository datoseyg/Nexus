import styles from "./ResponsiveTableShell.module.css";

export type TableDensity = "comfortable" | "compact";

interface ResponsiveTableShellProps {
  title: string;
  count?: number;
  countLabel?: string;
  actions?: React.ReactNode;
  maxHeight?: number | string;
  density?: TableDensity;
  onDensityChange?: (density: TableDensity) => void;
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyMessage?: string;
  beforeTable?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

// Chrome compartido para toda tabla de la app: header (título + conteo +
// acciones), contenedor con scroll (overflow-x/y auto, header sticky vía
// selectores :global() - no le importa qué implementación de <table>
// reciba como children, TanStack o markup plano), densidad
// cómoda/compacta, y estados de carga/error/vacío. Ver
// docs/VISUAL_REDESIGN_EYG.md § ResponsiveTableShell. Aplicado a: Tabla
// Uso de Repuestos, Detalle Operativo, Explorador de Tablas, Auditoría.
export function ResponsiveTableShell({
  title,
  count,
  countLabel = "filas",
  actions,
  maxHeight = 440,
  density = "comfortable",
  onDensityChange,
  loading = false,
  error = null,
  empty = false,
  emptyMessage = "Sin resultados para este filtro.",
  beforeTable,
  footer,
  children
}: ResponsiveTableShellProps) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.headerRow}>
        <div className={styles.titleGroup}>
          <span className={styles.title}>{title}</span>
          {typeof count === "number" && (
            <span className={styles.count}>
              {count.toLocaleString("es-CL")} {countLabel}
            </span>
          )}
        </div>
        <div className={styles.actions}>
          {actions}
          {onDensityChange && (
            <div className={styles.densityToggle}>
              <button
                type="button"
                className={density === "comfortable" ? styles.densityToggleActive : ""}
                onClick={() => onDensityChange("comfortable")}
              >
                Cómoda
              </button>
              <button
                type="button"
                className={density === "compact" ? styles.densityToggleActive : ""}
                onClick={() => onDensityChange("compact")}
              >
                Compacta
              </button>
            </div>
          )}
        </div>
      </div>

      {beforeTable}

      {/* tabIndex+role+aria-label: SC 2.1.1/4.1.2 (axe scrollable-region-focusable,
          hallado en Phase 3 reapertura §6) - sin esto un usuario de teclado no
          puede desplazar el contenido cuando es más ancho/alto que el viewport
          de la tabla. Compartido por toda tabla de la app (Repuestos, Detalle
          Operativo, Explorador, Auditoría), no solo Reportes. */}
      <div
        className={`${styles.scrollArea} ${density === "compact" ? styles.compact : ""}`}
        style={{ maxHeight }}
        tabIndex={0}
        role="region"
        aria-label={title}
      >
        {loading ? (
          <div className={styles.state}>Cargando…</div>
        ) : error ? (
          <div className={`${styles.state} ${styles.errorState}`}>{error}</div>
        ) : empty ? (
          <div className={styles.state}>{emptyMessage}</div>
        ) : (
          children
        )}
      </div>

      {footer && <div className={styles.footer}>{footer}</div>}
    </div>
  );
}
