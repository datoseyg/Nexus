"use client";

import { useState } from "react";
import { DataTable } from "@/components/DataTable";
import { QueryDisclosure } from "@/components/QueryDisclosure";
import { ErrorBanner } from "@/components/ErrorBanner";
import { AppShell } from "@/components/ui/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";

interface SearchResponse {
  query: string;
  keywords: string[];
  results: Array<Record<string, unknown>>;
  resultCount: number;
  queries: Array<{ label: string; sql: string }>;
  message?: string;
}

const RESULT_COLUMNS = [
  "fieldbeat_task_id",
  "fieldbeat_task_date",
  "client_name",
  "equipment_internal_ids",
  "task_type",
  "task_state",
  "technician_names",
  "linked_zendesk_ticket_id",
  "used_part_names",
  "used_part_numbers",
  "dolibarr_refs",
  "description",
  "field_name",
  "field_value"
];

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [loading, setLoading] = useState(false);

  function handleSearch() {
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setData(null);

    fetch(`/api/search?q=${encodeURIComponent(query)}`)
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw body;
        setData(body);
      })
      .catch(body => setError({ message: body?.error ?? "Error desconocido", code: body?.code }))
      .finally(() => setLoading(false));
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Búsqueda / Lupa"
          description="Búsqueda por palabras clave, sin IA en este corte — cada palabra debe aparecer en cliente, tipo de trabajo, descripción del reporte, o en algún campo de texto libre del formulario técnico."
        />

        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => event.key === "Enter" && handleSearch()}
            placeholder='Ej: "Clínica Alemana tubo", "cambio de tubo", "colimador"'
            className="flex-1 rounded border px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--surface-1)", color: "var(--text-primary)" }}
          />
          <button
            type="button"
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className="rounded px-4 py-2 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--eyg-green-dark)", color: "#fff" }}
          >
            Buscar
          </button>
        </div>

        {error && <ErrorBanner message={error.message} code={error.code} />}

        {loading && <p style={{ color: "var(--text-muted)" }}>Buscando…</p>}

        {data?.message && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {data.message}
          </p>
        )}

        {data && data.results.length > 0 && (
          <ResponsiveTableShell
            title="Resultados"
            count={data.resultCount}
            countLabel={`resultado(s) para: ${data.keywords.map(k => `"${k}"`).join(", ")}`}
            loading={loading}
            maxHeight={520}
          >
            <DataTable columnNames={RESULT_COLUMNS} rows={data.results} />
          </ResponsiveTableShell>
        )}

        {data && data.results.length === 0 && !data.message && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Sin resultados para esa búsqueda. Probá con menos palabras o términos más generales.
          </p>
        )}

        {data && data.queries.length > 0 && <QueryDisclosure queries={data.queries} />}
      </div>
    </AppShell>
  );
}
