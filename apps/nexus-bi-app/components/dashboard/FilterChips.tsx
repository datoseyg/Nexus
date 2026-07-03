import styles from "./dashboard.module.css";

export interface FilterChipItem {
  key: string;
  label: string;
  value: string;
}

interface FilterChipsProps {
  items: FilterChipItem[];
  onRemove: (key: string) => void;
}

// Chips de filtros activos ("Cliente: Clínica Alemana  x") — feedback
// visual del cross-filter: cada click en un gráfico agrega un chip acá,
// removible individualmente sin borrar el resto de los filtros. Ver
// docs/DASHBOARD_VISUAL_STYLE.md § Cross-filter.
export function FilterChips({ items, onRemove }: FilterChipsProps) {
  if (items.length === 0) return null;

  return (
    <div className={styles.chipBar}>
      {items.map(item => (
        <span key={item.key} className={styles.chip} title={`${item.label}: ${item.value}`}>
          <span>
            {item.label}: {item.value}
          </span>
          <button type="button" className={styles.chipRemove} onClick={() => onRemove(item.key)} aria-label={`Quitar filtro ${item.label}`}>
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
