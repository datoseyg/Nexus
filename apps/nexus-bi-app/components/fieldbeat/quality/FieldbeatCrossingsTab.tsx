"use client";

import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { useAfterHoursSection } from "@/lib/use-after-hours-section";
import { isCrossingEmpty } from "@/lib/fieldbeat-tab-empty-predicates";
import { CROSSING_TYPES, CROSSING_LABELS, type CrossingType, type FieldbeatCrossingResponse } from "@/types/fieldbeat-crossings";

interface FieldbeatCrossingsTabProps {
  crossing: CrossingType;
  onCrossingChange: (type: CrossingType) => void;
  query: string;
}

// Cruces orientados a problemas (Phase 3 §9) - SOLO se monta cuando la
// pestaña Cruces está abierta (montaje condicional en FieldbeatShell,
// nunca oculto con CSS) - eso ya garantiza "cero requests antes de abrir
// Cruces". El cruce #1 se pide al montar; los demás solo cuando el
// usuario los selecciona (la query cambia -> useAfterHoursSection
// refetch, nunca antes).
export function FieldbeatCrossingsTab({ crossing, onCrossingChange, query }: FieldbeatCrossingsTabProps) {
  const fullQuery = query ? `type=${crossing}&${query}` : `type=${crossing}`;
  const { status, data, error, retry } = useAfterHoursSection<FieldbeatCrossingResponse>("/api/dashboard/fieldbeat/crossings", fullQuery, isCrossingEmpty);
  const loading = status === "idle" || status === "loading";

  return (
    <div className="flex flex-col gap-4">
      <div aria-live="polite" className="sr-only">
        {loading ? `Cargando cruce ${CROSSING_LABELS[crossing].title}…` : status === "empty" ? "Sin datos para este cruce." : ""}
      </div>

      <fieldset className="flex flex-wrap gap-1.5 border-0 p-0">
        <legend className="mb-1 text-[12px] font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
          Cruce
        </legend>
        {CROSSING_TYPES.map(type => {
          const isActive = type === crossing;
          return (
            <button
              key={type}
              type="button"
              aria-pressed={isActive}
              onClick={() => onCrossingChange(type)}
              className="rounded-[var(--nx-radius-chip)] px-3 py-1.5 text-[12.5px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nx-focus-ring-color)]"
              style={
                isActive
                  ? { background: "var(--nx-accent-indigo)", color: "#fff" }
                  : { background: "var(--nx-page-bg)", color: "var(--nx-text-secondary)", border: "1px solid var(--nx-border)" }
              }
            >
              {CROSSING_LABELS[type].title}
            </button>
          );
        })}
      </fieldset>

      {status === "error" && (
        <div role="alert" className="flex flex-col items-start gap-3">
          <ErrorBanner message={error ?? "No fue posible cargar este cruce."} />
          <button
            type="button"
            onClick={retry}
            className="rounded-[var(--nx-radius-chip)] px-3.5 py-1.5 text-[13px] font-semibold"
            style={{ background: "var(--nx-accent-indigo)", color: "#fff" }}
          >
            Reintentar
          </button>
        </div>
      )}

      {loading && (
        <div aria-busy="true" className="h-64 animate-pulse rounded-[var(--nx-radius-card)]" style={{ background: "var(--nx-card-bg)" }} />
      )}

      {status === "empty" && <EmptyState title="Sin datos para este cruce" description="No hay reportes que coincidan con el filtro actual para esta combinación." />}

      {data && status !== "empty" && !loading && (
        <div className="rounded-[var(--nx-radius-card)] p-4" style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}>
          <h3 className="mb-1 text-[13px] font-bold" style={{ color: "var(--nx-text-primary)" }}>
            {data.rowDimensionLabel} × {data.colDimensionLabel}
          </h3>
          <p className="mb-3 text-[12px]" style={{ color: "var(--nx-text-muted)" }}>
            {data.grandTotal.toLocaleString("es-CL")} reportes en total - mostrando {data.shownRows.toLocaleString("es-CL")} de {data.totalRows.toLocaleString("es-CL")} filas
            {data.totalCols > data.shownCols ? ` y ${data.shownCols.toLocaleString("es-CL")} de ${data.totalCols.toLocaleString("es-CL")} columnas` : ""}
            {data.aggregated && " - valores de menor volumen agrupados en \"Otros\"/\"Otras\""}.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-[12.5px]">
              <caption className="sr-only">
                Tabla de {data.rowDimensionLabel} por {data.colDimensionLabel}, {data.grandTotal} reportes en total.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="border-b p-2 text-left" style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)" }}>
                    {data.rowDimensionLabel}
                  </th>
                  {data.cols.map(col => (
                    <th key={col} scope="col" className="border-b p-2 text-right" style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)" }}>
                      {col}
                    </th>
                  ))}
                  <th scope="col" className="border-b p-2 text-right font-bold" style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-primary)" }}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(row => (
                  <tr key={row}>
                    <th scope="row" className="border-b p-2 text-left font-normal" style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-primary)" }}>
                      {row}
                    </th>
                    {data.cols.map(col => {
                      const cell = data.cells.find(c => c.row === row && c.col === col);
                      const value = cell?.count ?? 0;
                      const max = Math.max(1, ...data.cols.map(c => data.cells.find(x => x.row === row && x.col === c)?.count ?? 0));
                      const intensity = value / max;
                      return (
                        <td
                          key={col}
                          className="border-b p-2 text-right"
                          style={{ borderColor: "var(--nx-border)", background: value > 0 ? `rgba(124,92,191,${0.08 + intensity * 0.22})` : "transparent" }}
                        >
                          {value > 0 ? value.toLocaleString("es-CL") : "-"}
                        </td>
                      );
                    })}
                    <td className="border-b p-2 text-right font-bold" style={{ borderColor: "var(--nx-border)" }}>
                      {(data.rowTotals[row] ?? 0).toLocaleString("es-CL")}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className="p-2 text-left font-bold" style={{ color: "var(--nx-text-primary)" }}>
                    Total
                  </th>
                  {data.cols.map(col => (
                    <td key={col} className="p-2 text-right font-bold">
                      {(data.colTotals[col] ?? 0).toLocaleString("es-CL")}
                    </td>
                  ))}
                  <td className="p-2 text-right font-bold">{data.grandTotal.toLocaleString("es-CL")}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
