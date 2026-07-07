import { ResponsiveTableShell } from "@/components/ui/ResponsiveTableShell";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { LifecycleConfidenceBadge } from "./LifecycleConfidenceBadge";
import type { LifecycleAggregateRow } from "@/types/equipment-lifecycle";

interface MachinePartsTableProps {
  parts: LifecycleAggregateRow[];
  loading: boolean;
  selectedDolibarrRef: string | undefined;
  onSelectPart: (dolibarrRef: string, equipmentInternalId: string | null | undefined) => void;
  showMachineColumn?: boolean;
}

// prediction_status (ver src/models/lifecycle/lifecycle-model-selector.js) -
// reemplaza el estimate_status de 3 valores de la sesión anterior.
function predictionStatusBadge(status: string): { label: string; tone: StatusTone } {
  switch (status) {
    case "DIRECT_HISTORY_ENOUGH":
      return { label: "Historial propio suficiente", tone: "success" };
    case "LOW_N_SHRINKAGE":
      return { label: "Shrinkage (n bajo)", tone: "warning" };
    case "BORROWED_COHORT_ESTIMATE":
      return { label: "Prestado de cohorte", tone: "warning" };
    case "RATE_MODEL_ESTIMATE":
      return { label: "Tasa Gamma-Poisson", tone: "info" };
    case "UNSTABLE_MODEL":
      return { label: "Modelo inestable", tone: "danger" };
    case "INSUFFICIENT_DATA":
      return { label: "Datos insuficientes", tone: "danger" };
    default:
      return { label: status, tone: "neutral" };
  }
}

const MODEL_LABELS: Record<string, string> = {
  MEDIAN_INTERVAL: "Mediana empírica",
  TRIMMED_MEAN_INTERVAL: "Media recortada",
  EMPIRICAL_BAYES_SHRINKAGE: "Shrinkage",
  BAYESIAN_WEIBULL_GRID: "Weibull bayesiano",
  GAMMA_POISSON_RATE_MODEL: "Tasa Gamma-Poisson",
  NONE: "-"
};

function formatDays(days: number | null): string {
  if (days === null || days === undefined) return "-";
  return `${Math.round(days)} días`;
}

function formatDate(value: string | null): string {
  return value ? value.slice(0, 10) : "-";
}

function formatWeight(value: number | null): string {
  return value === null || value === undefined ? "-" : `${Math.round(value * 100)}%`;
}

// Tabla de repuestos de la máquina seleccionada (Parte 8.4 / Parte 11) - fila
// clickeable para elegir el repuesto que alimenta timeline/comparación/
// insights. Fuente: gold.equipment_part_lifecycle_by_machine vía
// /api/dashboard/equipment-lifecycle/machine/[equipmentId]. Cuando el
// filtro de máquina está en "Todas" (showMachineColumn=true), las filas
// vienen de máquinas distintas - se agrega la columna "Máquina" y al
// hacer clic en una fila se "baja" a esa máquina puntual (ver
// EquipmentLifecycleShell.tsx).
export function MachinePartsTable({ parts, loading, selectedDolibarrRef, onSelectPart, showMachineColumn = false }: MachinePartsTableProps) {
  return (
    <ResponsiveTableShell
      title={showMachineColumn ? "Repuestos observados en todas las máquinas" : "Repuestos observados en esta máquina"}
      count={parts.length}
      loading={loading}
      empty={!loading && parts.length === 0}
      emptyMessage="No hay repuestos con match confirmado para este filtro todavía."
      maxHeight={460}
    >
      <table>
        <thead>
          <tr>
            {showMachineColumn && <th>Máquina</th>}
            <th>SKU Dolibarr</th>
            <th>Nombre repuesto</th>
            <th>Eventos</th>
            <th>Intervalos</th>
            <th>Modelo</th>
            <th>Vida estimada</th>
            <th>Intervalo probable (p10-p90)</th>
            <th>Próxima reposición estimada</th>
            <th>Peso máquina/cohorte</th>
            <th>Fuente cohorte</th>
            <th>Confiabilidad</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {parts.map(row => {
            const status = predictionStatusBadge(row.prediction_status);
            const isSelected = selectedDolibarrRef === row.dolibarr_ref;
            const hasWeights = row.machine_weight !== null && row.cohort_weight !== null;
            return (
              <tr
                key={`${row.equipment_internal_id ?? ""}-${row.dolibarr_ref}`}
                onClick={() => onSelectPart(row.dolibarr_ref, row.equipment_internal_id)}
                style={{ cursor: "pointer", background: isSelected ? "var(--eyg-teal-light, rgba(23,95,95,0.08))" : undefined }}
              >
                {showMachineColumn && <td title={row.client_name ?? ""}>{row.equipment_internal_id ?? "-"}</td>}
                <td>{row.dolibarr_ref}</td>
                <td title={row.dolibarr_label ?? ""}>{row.dolibarr_label ?? "-"}</td>
                <td>{row.n_events}</td>
                <td>{row.n_intervals}</td>
                <td>{MODEL_LABELS[row.selected_model] ?? row.selected_model}</td>
                <td>{formatDays(row.estimated_life_days)}</td>
                <td>
                  {row.estimated_life_p10_days !== null && row.estimated_life_p90_days !== null
                    ? `${Math.round(row.estimated_life_p10_days)}-${Math.round(row.estimated_life_p90_days)} días`
                    : "-"}
                </td>
                <td>{formatDate(row.predicted_next_replacement_date)}</td>
                <td>{hasWeights ? `${formatWeight(row.machine_weight)} / ${formatWeight(row.cohort_weight)}` : "-"}</td>
                <td title={row.cohort_source ?? ""}>{row.cohort_source ?? "-"}</td>
                <td>
                  <LifecycleConfidenceBadge score={row.model_confidence_score} label={row.model_confidence_label} factors={row.model_confidence_factors} size="sm" />
                </td>
                <td>
                  <StatusBadge label={status.label} tone={status.tone} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ResponsiveTableShell>
  );
}
