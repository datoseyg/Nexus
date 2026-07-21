"use client";

import { useId, useState } from "react";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FOCUS_RING } from "./search.styles";

interface SearchFormProps {
  initialQuery: string;
  loading: boolean;
  onSubmit: (query: string) => void;
  onClearAll: () => void;
}

// Disparador de búsqueda: SOLO submit/Enter - nunca blur, nunca por
// pulsación de tecla individual. El estado local (draft) puede diferir de
// la última consulta comprometida hasta que el usuario presiona Buscar.
// `loading` (del padre) deshabilita Buscar mientras la request está en
// curso - evita doble submit y muestra "Buscando…" sin cambiar el ancho
// del botón (min-width fijo).
export function SearchForm({ initialQuery, loading, onSubmit, onClearAll }: SearchFormProps) {
  const [draft, setDraft] = useState(initialQuery);
  const inputId = useId();
  const describedById = useId();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;
    onSubmit(draft);
  }

  function handleClear() {
    setDraft("");
    onClearAll();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-[var(--nx-radius-card)] p-4 sm:flex-row"
      style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}
    >
      <label htmlFor={inputId} className="sr-only">
        Buscar por cliente, máquina, reporte, ticket o repuesto
      </label>
      <input
        id={inputId}
        type="text"
        value={draft}
        onChange={event => setDraft(event.target.value)}
        placeholder="Buscar por cliente, máquina, reporte, ticket o SKU"
        aria-describedby={describedById}
        className={`flex-1 rounded-[var(--nx-radius-button)] px-3.5 text-[14px] ${FOCUS_RING}`}
        style={{ border: "1px solid var(--nx-border)", color: "var(--nx-text-primary)", minHeight: 44 }}
      />
      <span id={describedById} className="sr-only">
        La búsqueda se ejecuta al presionar Buscar o Enter, no mientras escribe.
      </span>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          aria-busy={loading}
          className={`inline-flex min-w-[104px] items-center justify-center whitespace-nowrap rounded-[var(--nx-radius-button)] px-5 text-[14px] font-semibold text-white ${BUTTON_PRIMARY}`}
          style={{ background: "var(--nx-sidebar-bg)", minHeight: 44 }}
        >
          {loading ? "Buscando…" : "Buscar"}
        </button>
        <button
          type="button"
          onClick={handleClear}
          className={`whitespace-nowrap rounded-[var(--nx-radius-button)] border px-4 text-[14px] font-semibold ${BUTTON_SECONDARY}`}
          style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", minHeight: 44 }}
        >
          Limpiar
        </button>
      </div>
    </form>
  );
}
