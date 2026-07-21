export interface FilterChipItem {
  key: string;
  label: string;
  value: string;
}

interface FilterChipsProps {
  items: FilterChipItem[];
  onRemove: (key: string) => void;
}

// Chips de filtros activos ("Cliente: Clínica Alemana  ×") - feedback
// visual del cross-filter: cada click en un gráfico agrega un chip acá,
// removible individualmente sin borrar el resto de los filtros. Migrado
// a tokens --nx-* (chip oscuro, igual al standalone de Dashboard
// Operacional).
export function FilterChips({ items, onRemove }: FilterChipsProps) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(item => (
        <span
          key={item.key}
          className="inline-flex max-w-full items-center gap-1.5 rounded-[var(--nx-radius-pill)] py-1.5 pl-3 pr-1.5 text-[13px]"
          style={{ background: "var(--nx-sidebar-bg)", color: "#ffffff" }}
          title={`${item.label}: ${item.value}`}
        >
          <span className="max-w-[240px] truncate">
            {item.label}: {item.value}
          </span>
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nx-focus-ring-color)]"
            style={{ background: "rgba(255,255,255,0.16)", color: "#ffffff" }}
            onClick={() => onRemove(item.key)}
            aria-label={`Quitar filtro ${item.label}`}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
