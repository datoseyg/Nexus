"use client";

import { useEffect, useRef, useState } from "react";

interface SearchInputProps {
  value: string | undefined;
  onSearch: (value: string | undefined) => void;
  placeholder?: string;
  debounceMs?: number;
}

const inputStyle = {
  borderColor: "var(--eyg-border)",
  background: "var(--eyg-card)",
  color: "var(--text-primary)"
} as const;

// Input de búsqueda libre reutilizable - lupa + botón limpiar + debounce
// (no dispara onSearch en cada tecla, espera `debounceMs` de inactividad).
// El valor final se pasa como texto plano (sin "%"/comodines) - quien
// arma el SQL (lib/filter-utils.ts::buildSearchCondition) es responsable
// de tokenizar y parametrizar.
export function SearchInput({ value, onSearch, placeholder = "Buscar...", debounceMs = 300 }: SearchInputProps) {
  const [draft, setDraft] = useState(value ?? "");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  function scheduleSearch(next: string) {
    setDraft(next);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      onSearch(next.trim() || undefined);
    }, debounceMs);
  }

  function handleClear() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setDraft("");
    onSearch(undefined);
  }

  return (
    <div className="relative flex items-center">
      <span className="pointer-events-none absolute left-2.5 text-sm" style={{ color: "var(--text-muted)" }} aria-hidden>
        🔍
      </span>
      <input
        type="text"
        className="rounded border py-1.5 pl-7 pr-7 text-sm"
        style={inputStyle}
        placeholder={placeholder}
        value={draft}
        onChange={event => scheduleSearch(event.target.value)}
      />
      {draft && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-2 text-sm"
          style={{ color: "var(--text-muted)" }}
          aria-label="Limpiar búsqueda"
        >
          ×
        </button>
      )}
    </div>
  );
}
