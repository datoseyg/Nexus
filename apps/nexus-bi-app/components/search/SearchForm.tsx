"use client";

import { useId, useState } from "react";

interface SearchFormProps {
  initialQuery: string;
  onSubmit: (query: string) => void;
  onClearAll: () => void;
}

const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nx-focus-ring-color)]";

// Disparador de búsqueda: SOLO submit/Enter - nunca blur, nunca por
// pulsación de tecla individual. El estado local (draft) puede diferir de
// la última consulta comprometida hasta que el usuario presiona Buscar.
export function SearchForm({ initialQuery, onSubmit, onClearAll }: SearchFormProps) {
  const [draft, setDraft] = useState(initialQuery);
  const inputId = useId();
  const describedById = useId();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
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
          className={`whitespace-nowrap rounded-[var(--nx-radius-button)] px-5 text-[14px] font-semibold text-white ${FOCUS_RING}`}
          style={{ background: "var(--nx-sidebar-bg)", minHeight: 44 }}
        >
          Buscar
        </button>
        <button
          type="button"
          onClick={handleClear}
          className={`whitespace-nowrap rounded-[var(--nx-radius-button)] border px-4 text-[14px] font-semibold ${FOCUS_RING}`}
          style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)", minHeight: 44 }}
        >
          Limpiar
        </button>
      </div>
    </form>
  );
}
