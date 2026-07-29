import type { SearchQueryExplanation } from "@/types/search";

interface SearchQueryExplanationPanelProps {
  explanation: SearchQueryExplanation;
}

// Gate B (B24/21.12) - reemplaza el panel "Ver query" (QueryDisclosure,
// retirado): nunca schema/tabla/columna/join/SQL, solo una descripción en
// lenguaje de negocio de qué se buscó, qué filtros aplicaron, cómo se
// relacionan los resultados y qué límites tiene la vista. Retirado de la
// experiencia productiva para AMBOS roles (decisión cerrada de Gate A) - no
// existe una versión "técnica" de esto en ningún lado del producto.
export function SearchQueryExplanationPanel({ explanation }: SearchQueryExplanationPanelProps) {
  return (
    <details className="rounded-lg border p-3" style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}>
      <summary className="cursor-pointer text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        Cómo se buscó esto
      </summary>

      <div className="mt-3 flex flex-col gap-2 text-sm" style={{ color: "var(--text-primary)" }}>
        <p>
          Se buscó en: <strong>{explanation.entitiesSearched.join(", ")}</strong>.
        </p>
        {explanation.filtersApplied.length > 0 && (
          <p>
            Filtros aplicados:{" "}
            {explanation.filtersApplied.map((f, idx) => (
              <span key={f.label}>
                {idx > 0 ? ", " : ""}
                <strong>{f.label}</strong> = {f.value}
              </span>
            ))}
            .
          </p>
        )}
        <p>{explanation.resultRelation}</p>
        {explanation.resultLimits.map(limit => (
          <p key={limit} style={{ color: "var(--text-muted)" }}>
            {limit}
          </p>
        ))}
      </div>
    </details>
  );
}
