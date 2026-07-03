interface QueryDisclosureProps {
  queries: Array<{ label: string; sql: string }>;
}

// <details> nativo: cero JS extra para un colapsable simple.
export function QueryDisclosure({ queries }: QueryDisclosureProps) {
  if (queries.length === 0) return null;

  return (
    <details className="rounded-lg border p-3" style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}>
      <summary className="cursor-pointer text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        Ver query
      </summary>

      <div className="mt-3 flex flex-col gap-3">
        {queries.map(query => (
          <div key={query.label}>
            <p className="mb-1 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              {query.label}
            </p>
            <pre
              className="overflow-x-auto rounded p-2 text-xs"
              style={{ background: "var(--page-plane)", color: "var(--text-primary)" }}
            >
              {query.sql}
            </pre>
          </div>
        ))}
      </div>
    </details>
  );
}
