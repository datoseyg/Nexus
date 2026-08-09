import type { ContractScheduleResult, ContractServiceWindow } from "@/types/contracts";
import { resolveContractCoverageState } from "@/lib/contracts-vocabulary";

export interface ContractCoverageScheduleViewProps {
  result: ContractScheduleResult;
  /** Solo lo pasan el detalle de reporte y el drawer After-Hours (tienen un
   * data_basis de tarea contra el cual comparar el horario efectivamente
   * usado) - el drawer de Contratos por sí solo nunca lo pasa, no tiene
   * noción de "tarea aplicada". El horario global de respaldo NUNCA se
   * presenta como si fuera parte del contrato - por eso esta línea va
   * siempre separada (borde propio), nunca mezclada con los campos de
   * arriba. */
  appliedSource?: { label: string; reason?: string | null } | null;
}

function formatScheduleDate(value: string | null): string {
  return typeof value === "string" ? value.slice(0, 10) : "-";
}

function formatWindowTime(window: ContractServiceWindow): string {
  if (window.allDay) return "Todo el día";
  if (!window.startTime || !window.endTime) return "-";
  return `${window.startTime.slice(0, 5)} - ${window.endTime.slice(0, 5)}`;
}

function formatTriState(value: boolean | null): string {
  if (value === null) return "No informado";
  return value ? "Sí" : "No";
}

/**
 * Componente compartido, único (Bloque 2 NEXUS V3) - recibe un
 * ContractScheduleResult YA RESUELTO (tipado, sin fetch propio, sin
 * interpretar texto contractual). Consumidores reales: drawer de Contratos
 * (ExplorerDetailDrawer), detalle canónico de Reportes
 * (FieldbeatReportDetailContent.tsx) y el mismo punto de montaje cuando el
 * contexto es After-Hours (appliedSource poblado). Responsabilidad única:
 * renderizar días/ventanas/cobertura/vigencia/fuente - nunca un framework
 * genérico de calendario, nunca consulta datos.
 */
export function ContractCoverageScheduleView({ result, appliedSource }: ContractCoverageScheduleViewProps) {
  const state = resolveContractCoverageState(result);
  const schedule = result.status === "AVAILABLE" ? result.schedule : null;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
        Horario de cobertura contractual
      </span>

      <div className="rounded border px-2 py-1.5 text-sm" style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-primary)" }}>
        <p>
          {state.message}
          {state.needsReview && (
            <span
              className="ml-2 rounded px-1.5 py-0.5 text-xs font-semibold"
              style={{ background: "var(--nx-warning-bg, #fdf3d8)", color: "var(--nx-warning, #92620a)" }}
            >
              Requiere revisión
            </span>
          )}
        </p>

        {schedule && (
          <div className="mt-2 flex flex-col gap-2">
            {schedule.windows.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left" style={{ color: "var(--nx-text-secondary)" }}>
                      Día
                    </th>
                    <th className="text-left" style={{ color: "var(--nx-text-secondary)" }}>
                      Horario
                    </th>
                    <th className="text-left" style={{ color: "var(--nx-text-secondary)" }}>
                      Feriados
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.windows.map(window => (
                    <tr key={window.dayOfWeek}>
                      <td style={{ color: "var(--nx-text-primary)" }}>{window.dayLabel}</td>
                      <td style={{ color: "var(--nx-text-primary)" }}>{formatWindowTime(window)}</td>
                      <td style={{ color: "var(--nx-text-primary)" }}>{window.includesHolidays ? "Sí" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div>
                <dt className="text-xs font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
                  Zona horaria
                </dt>
                <dd>{schedule.timezone}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
                  Cobertura de fin de semana
                </dt>
                <dd>{formatTriState(schedule.coversWeekends)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
                  Cobertura de feriados
                </dt>
                <dd>{formatTriState(schedule.coversHolidays)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
                  Vigente desde
                </dt>
                <dd>{formatScheduleDate(schedule.effectiveFrom)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
                  Vigente hasta
                </dt>
                <dd>{formatScheduleDate(schedule.effectiveTo)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
                  Fuente de resolución
                </dt>
                <dd>Configuración contractual vigente</dd>
              </div>
            </dl>
          </div>
        )}

        {appliedSource && (
          <p className="mt-2 border-t pt-2 text-sm" style={{ borderColor: "var(--nx-border)" }}>
            <strong>Horario aplicado al cálculo:</strong> {appliedSource.label}
            {appliedSource.reason ? ` - ${appliedSource.reason}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}
