"use client";

import { useMemo, useRef, useState } from "react";
import { AfterHoursSectionCard } from "./AfterHoursSectionCard";
import { AfterHoursEmptyBlock } from "./AfterHoursEmptyBlock";
import { maxOf } from "@/lib/after-hours-bar-list-view";
import { formatHours, formatInt } from "@/lib/after-hours-kpi-view";
import { getWeekdayLabel, getWeekdayShortLabel, WEEKDAY_ORDER } from "@/lib/after-hours-labels";
import { heatmapBucket } from "@/lib/after-hours-weekday-view";
import type { AfterHoursWeekdayHourCell } from "@/types/after-hours";

const HOURS: readonly number[] = Array.from({ length: 24 }, (_, h) => h);

interface AfterHoursWeekdayHourHeatmapProps {
  cells: AfterHoursWeekdayHourCell[]; // siempre 168 (padWeekdayHourCells)
  status?: "idle" | "loading" | "refreshing" | "success" | "empty" | "error";
  error?: string | null;
  onRetry?: () => void;
  onSelect?: (weekday: number, hour: number) => void;
  onClear?: () => void;
  selectedWeekday?: number | null;
  selectedHour?: number | null;
}

// "¿En qué días y horas se concentra?" - cruce día×hora (ETAPA 6.6D, antes
// placeholder AfterHoursNotYetAvailable). Tabla semántica con ROVING
// TABINDEX (nunca 168 paradas de Tab): solo una celda está en el orden de
// Tab en un momento dado; flechas navegan, Home/End se mueven dentro de la
// fila, Enter/Space seleccionan, Escape limpia la selección aplicada.
// Rampa de color secuencial de un solo hue (--nx-heat-0..5) - nunca el
// único canal de información, cada celda lleva su dato completo en
// aria-label/title.
export function AfterHoursWeekdayHourHeatmap({
  cells,
  status = "success",
  error,
  onRetry,
  onSelect,
  onClear,
  selectedWeekday,
  selectedHour
}: AfterHoursWeekdayHourHeatmapProps) {
  const [active, setActive] = useState<{ weekday: number; hour: number }>({ weekday: 1, hour: 0 });
  const cellRefs = useRef<Map<string, HTMLButtonElement | HTMLSpanElement | null>>(new Map());

  const cellMap = useMemo(() => new Map(cells.map(c => [`${c.weekday}_${c.hour}`, c])), [cells]);
  const max = useMemo(() => maxOf(cells.map(c => c.after_hours_total_hours)), [cells]);
  const hasData = cells.some(c => c.total_tasks > 0);

  function focusCell(weekday: number, hour: number) {
    setActive({ weekday, hour });
    // Se enfoca de forma imperativa tras el próximo render - el ref ya
    // apunta al botón correspondiente porque el mapa de refs se llena en
    // cada render, antes de que el usuario pueda volver a presionar una tecla.
    requestAnimationFrame(() => {
      cellRefs.current.get(`${weekday}_${hour}`)?.focus();
    });
  }

  function handleKeyDown(e: React.KeyboardEvent, weekday: number, hour: number) {
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        focusCell(weekday, Math.min(23, hour + 1));
        break;
      case "ArrowLeft":
        e.preventDefault();
        focusCell(weekday, Math.max(0, hour - 1));
        break;
      case "ArrowDown":
        e.preventDefault();
        focusCell(Math.min(7, weekday + 1), hour);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusCell(Math.max(1, weekday - 1), hour);
        break;
      case "Home":
        e.preventDefault();
        focusCell(weekday, 0);
        break;
      case "End":
        e.preventDefault();
        focusCell(weekday, 23);
        break;
      case "Enter":
      case " ": {
        e.preventDefault();
        const cell = cellMap.get(`${weekday}_${hour}`);
        if (cell && cell.total_tasks > 0) onSelect?.(weekday, hour);
        break;
      }
      case "Escape":
        e.preventDefault();
        onClear?.();
        break;
      default:
        break;
    }
  }

  return (
    <AfterHoursSectionCard question="¿En qué días y horas se concentra?" subtitle="Cruce de día y hora">
      {status === "error" ? (
        <AfterHoursEmptyBlock layout="column" tone="error" title="No se pudo cargar esta sección" description={error ?? "Intenta nuevamente en unos minutos."} onRetry={onRetry} />
      ) : status === "loading" ? (
        <div className="h-40 animate-pulse rounded" style={{ background: "var(--nx-page-bg)" }} aria-live="polite" aria-busy="true" />
      ) : (
        <div style={status === "refreshing" ? { opacity: 0.6 } : undefined} aria-busy={status === "refreshing"}>
          {status === "refreshing" && (
            <div className="mb-1 text-[11px]" style={{ color: "var(--nx-text-muted)" }}>
              Actualizando…
            </div>
          )}
          {!hasData && (
            <div className="mb-2 text-[13px]" style={{ color: "var(--nx-text-muted)" }} role="status">
              Sin actividad en el rango filtrado.
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-[820px] border-separate" style={{ borderSpacing: "2px" }}>
              <caption className="sr-only">Horas fuera de horario por día de la semana y hora del día</caption>
              <thead>
                <tr>
                  <th scope="col" className="w-20" />
                  {HOURS.map(h => (
                    <th key={h} scope="col" className="w-7 text-center text-[10px] font-normal" style={{ color: "var(--nx-text-muted)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {WEEKDAY_ORDER.map(weekday => (
                  <tr key={weekday}>
                    <th scope="row" className="pr-2 text-left text-[12px] font-semibold" style={{ color: "var(--nx-text-secondary)" }} title={getWeekdayLabel(weekday)}>
                      {getWeekdayShortLabel(weekday)}
                    </th>
                    {HOURS.map(hour => {
                      const cell = cellMap.get(`${weekday}_${hour}`);
                      const tasks = cell?.total_tasks ?? 0;
                      const afterHours = cell?.after_hours_total_hours ?? 0;
                      const bucket = heatmapBucket(afterHours, max);
                      const isActive = active.weekday === weekday && active.hour === hour;
                      const isSelected = selectedWeekday === weekday && selectedHour === hour;
                      const label =
                        tasks > 0
                          ? `${getWeekdayLabel(weekday)}, ${hour}:00, ${formatHours(afterHours)} fuera de horario, ${formatInt(tasks)} tareas`
                          : `${getWeekdayLabel(weekday)}, ${hour}:00, sin actividad`;

                      return (
                        <td key={hour} className="p-0">
                          <button
                            type="button"
                            ref={el => {
                              cellRefs.current.set(`${weekday}_${hour}`, el);
                            }}
                            tabIndex={isActive ? 0 : -1}
                            aria-label={label}
                            title={label}
                            aria-pressed={isSelected}
                            onFocus={() => setActive({ weekday, hour })}
                            onKeyDown={e => handleKeyDown(e, weekday, hour)}
                            onClick={() => {
                              if (tasks > 0) onSelect?.(weekday, hour);
                            }}
                            className="h-7 w-7 rounded-sm text-[9px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
                            style={{
                              background: `var(--nx-heat-${bucket})`,
                              outlineColor: "var(--nx-focus-ring-color)",
                              border: isSelected ? "1.5px solid var(--nx-accent-indigo-hover)" : "1px solid transparent",
                              cursor: tasks > 0 ? "pointer" : "default"
                            }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-[12px] font-semibold" style={{ color: "var(--nx-accent-indigo)" }}>
              Ver datos en tabla
            </summary>
            <table className="mt-2 w-full text-[12px]">
              <thead>
                <tr style={{ color: "var(--nx-text-muted)" }}>
                  <th scope="col" className="text-left font-normal">
                    Día
                  </th>
                  <th scope="col" className="text-left font-normal">
                    Hora
                  </th>
                  <th scope="col" className="text-right font-normal">
                    Horas fuera de horario
                  </th>
                  <th scope="col" className="text-right font-normal">
                    Tareas
                  </th>
                </tr>
              </thead>
              <tbody>
                {cells
                  .filter(c => c.total_tasks > 0)
                  .map(c => (
                    <tr key={`${c.weekday}_${c.hour}`}>
                      <td>{getWeekdayLabel(c.weekday)}</td>
                      <td>{String(c.hour).padStart(2, "0")}:00</td>
                      <td className="text-right">{formatHours(c.after_hours_total_hours)}</td>
                      <td className="text-right">{formatInt(c.total_tasks)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </AfterHoursSectionCard>
  );
}
