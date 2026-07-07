"use client";

import { useEffect, useState } from "react";
import { MetricCard } from "@/components/ui/MetricCard";
import { ErrorBanner } from "@/components/ErrorBanner";
import { AppShell } from "@/components/ui/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable } from "@/components/DataTable";
import { SelectWithAll, type SelectOption } from "@/components/ui/SelectWithAll";
import { SearchInput } from "@/components/ui/SearchInput";
import { getFieldbeatSummary, type FieldbeatSummaryResponse } from "@/lib/data-client";

const TABLE_COLUMNS = [
  "fieldbeat_task_id",
  "fieldbeat_task_date",
  "client_name",
  "task_type",
  "task_state",
  "used_parts_count",
  "matched_used_parts_count",
  "report_quality_status"
];

// Filtrable por cliente ("Todos" nunca viaja como filtro real - ver
// SelectWithAll) y búsqueda libre - pega contra /api/dashboard/fieldbeat
// (local-duckdb) o /api/d1/fieldbeat-summary (d1) según NEXT_PUBLIC_DATA_MODE,
// vía lib/data-client.ts::getFieldbeatSummary(). Ver
// docs/CLOUDFLARE_D1_MIGRATION.md.
export default function FieldBeatDashboardPage() {
  const [client, setClient] = useState<string | undefined>(undefined);
  const [q, setQ] = useState<string | undefined>(undefined);
  const [data, setData] = useState<FieldbeatSummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getFieldbeatSummary({ client, q })
      .then(body => {
        if (!cancelled) setData(body);
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error desconocido");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client, q]);

  const clientOptions: SelectOption[] = (data?.meta.clientOptions ?? []).map(name => ({ label: name, value: name }));

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Dashboard Operacional FieldBeat"
          description={
            <>
              Universo report-céntrico, filtrable por cliente y búsqueda libre.
              {data && (
                <>
                  {" "}
                  Fuente activa: <code>{data.source}</code>.
                </>
              )}
            </>
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <SelectWithAll label="Cliente" value={client} options={clientOptions} onChange={setClient} />
          <SearchInput value={q} onSearch={setQ} placeholder="Buscar cliente, tipo de tarea o calidad de reporte..." />
        </div>

        {error && <ErrorBanner message={error} />}

        {loading && !data && <p style={{ color: "var(--text-muted)" }}>Cargando…</p>}

        {data && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <MetricCard label="Reportes (filtrados)" value={data.meta.total} />
              <MetricCard label="Repuestos usados (filtrados)" value={data.meta.totalUsedParts} />
              <MetricCard label="Filas mostradas" value={data.data.length} hint={`Máximo 100 por consulta`} />
            </div>

            <DataTable columnNames={TABLE_COLUMNS} rows={data.data} />
          </>
        )}
      </div>
    </AppShell>
  );
}
