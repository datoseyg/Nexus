"use client";

import { useEffect, useState } from "react";
import { MetricCard } from "@/components/ui/MetricCard";
import { SelectWithAll } from "@/components/ui/SelectWithAll";
import { SearchInput } from "@/components/ui/SearchInput";
import { EquipmentSelector } from "./EquipmentSelector";
import { MachineProfileCard } from "./MachineProfileCard";
import { MachinePartsTable } from "./MachinePartsTable";
import { PartLifecycleCard } from "./PartLifecycleCard";
import { PartHistoryTimeline } from "./PartHistoryTimeline";
import { PartComparisonChart } from "./PartComparisonChart";
import { LifecycleInsightsPanel } from "./LifecycleInsightsPanel";
import { LifecycleEventsTable } from "./LifecycleEventsTable";
import type {
  EquipmentLifecycleEventRow,
  LifecycleAggregateRow,
  LifecycleInsightRow,
  LifecycleSummary,
  MachineListItem,
  MachineProfile
} from "@/types/equipment-lifecycle";

interface ComparisonData {
  machine: LifecycleAggregateRow | null;
  siblingMachines: LifecycleAggregateRow[];
  otherClients: LifecycleAggregateRow[];
  global: LifecycleAggregateRow | null;
}

interface Filters {
  client?: string;
  confidenceLevel?: string;
  estimateStatus?: string;
  model?: string;
  from?: string;
  to?: string;
  q?: string;
}

function toQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return search.toString();
}

const CONFIDENCE_LEVELS = ["Alta", "Media", "Baja", "Insuficiente"];

// prediction_status (ver src/models/lifecycle/lifecycle-model-selector.js) -
// reemplaza el estimate_status de 3 valores de la sesión anterior.
const ESTIMATE_STATUSES = [
  { value: "DIRECT_HISTORY_ENOUGH", label: "Historial propio suficiente" },
  { value: "LOW_N_SHRINKAGE", label: "Shrinkage (n bajo)" },
  { value: "BORROWED_COHORT_ESTIMATE", label: "Prestado de cohorte" },
  { value: "RATE_MODEL_ESTIMATE", label: "Tasa Gamma-Poisson" },
  { value: "UNSTABLE_MODEL", label: "Modelo inestable" },
  { value: "INSUFFICIENT_DATA", label: "Datos insuficientes" }
];

// Selector de modelo (Parte 11.3) - "Auto recomendado" = sin filtro
// (muestra combinaciones sin importar qué modelo eligió el AUTO para
// cada una). Filtra por la columna `selected_model` ya calculada en GOLD -
// no recalcula el modelo en la app.
const MODEL_OPTIONS = [
  { value: "MEDIAN_INTERVAL", label: "Mediana empírica" },
  { value: "TRIMMED_MEAN_INTERVAL", label: "Media recortada" },
  { value: "EMPIRICAL_BAYES_SHRINKAGE", label: "Shrinkage" },
  { value: "BAYESIAN_WEIBULL_GRID", label: "Weibull bayesiano" },
  { value: "GAMMA_POISSON_RATE_MODEL", label: "Tasa Gamma-Poisson" }
];

const inputStyle = {
  borderColor: "var(--eyg-border)",
  background: "var(--eyg-card)",
  color: "var(--text-primary)"
} as const;

// Orquestador de /dashboard/equipment-lifecycle - mismo patrón que
// AfterHoursShell.tsx: estado de filtros compartido, fetch paralelo a los
// endpoints, composición de KPIs -> selector -> ficha -> tabla de repuestos
// -> detalle/timeline/comparación/insights del repuesto elegido -> tabla de
// eventos base. Filtros con opción "Todos" (SelectWithAll) y búsqueda
// libre (SearchInput) - ver docs/EQUIPMENT_PART_LIFECYCLE_ANALYSIS.md.
export function EquipmentLifecycleShell() {
  const [filters, setFilters] = useState<Filters>({});
  const [selectedEquipment, setSelectedEquipment] = useState<string | undefined>(undefined);
  const [selectedDolibarrRef, setSelectedDolibarrRef] = useState<string | undefined>(undefined);

  const [summary, setSummary] = useState<LifecycleSummary | null>(null);
  const [machines, setMachines] = useState<MachineListItem[]>([]);
  const [machinesLoading, setMachinesLoading] = useState(true);

  const [profile, setProfile] = useState<MachineProfile | null>(null);
  const [parts, setParts] = useState<LifecycleAggregateRow[]>([]);
  const [machineDetailLoading, setMachineDetailLoading] = useState(false);

  const [partHistory, setPartHistory] = useState<EquipmentLifecycleEventRow[]>([]);
  const [partHistoryLoading, setPartHistoryLoading] = useState(false);
  const [comparison, setComparison] = useState<ComparisonData | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [insights, setInsights] = useState<LifecycleInsightRow[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);

  // KPIs globales - snapshot fijo salvo `q`, que solo afina las listas de
  // filterOptions (ver /api/dashboard/equipment-lifecycle/summary).
  useEffect(() => {
    const query = toQuery({ q: filters.q });
    fetch(`/api/dashboard/equipment-lifecycle/summary?${query}`)
      .then(res => res.json())
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [filters.q]);

  // Lista de máquinas para el selector, reactiva a los filtros.
  useEffect(() => {
    setMachinesLoading(true);
    const query = toQuery({
      client: filters.client, confidenceLevel: filters.confidenceLevel,
      estimateStatus: filters.estimateStatus, model: filters.model, q: filters.q
    });
    fetch(`/api/dashboard/equipment-lifecycle/machines?${query}`)
      .then(res => res.json())
      .then(body => setMachines(body.rows ?? []))
      .finally(() => setMachinesLoading(false));
  }, [filters.client, filters.confidenceLevel, filters.estimateStatus, filters.model, filters.q]);

  // Ficha + tabla de repuestos de la máquina seleccionada - "Todas" (sin
  // selectedEquipment) pega contra el sentinel "ALL" del endpoint, que
  // devuelve los repuestos de todas las máquinas y profile=null (no hay
  // una ficha única que mostrar). No resetea selectedDolibarrRef acá -
  // eso solo pasa cuando el usuario cambia la máquina desde el selector
  // (ver handleEquipmentChange), para no perder la selección al "bajar"
  // de Todas a una máquina puntual haciendo clic en una fila.
  useEffect(() => {
    setMachineDetailLoading(true);
    const query = toQuery({
      confidenceLevel: filters.confidenceLevel, estimateStatus: filters.estimateStatus,
      model: filters.model, from: filters.from, to: filters.to, q: filters.q
    });

    fetch(`/api/dashboard/equipment-lifecycle/machine/${encodeURIComponent(selectedEquipment ?? "ALL")}?${query}`)
      .then(res => res.json())
      .then(body => {
        setProfile(body.profile ?? null);
        setParts(body.parts ?? []);
      })
      .finally(() => setMachineDetailLoading(false));
  }, [selectedEquipment, filters.confidenceLevel, filters.estimateStatus, filters.model, filters.from, filters.to, filters.q]);

  // Timeline, comparación e insights del repuesto elegido dentro de la máquina.
  useEffect(() => {
    if (!selectedEquipment || !selectedDolibarrRef) {
      setPartHistory([]);
      setComparison(null);
      setInsights([]);
      return;
    }

    setPartHistoryLoading(true);
    setComparisonLoading(true);
    setInsightsLoading(true);

    const historyQuery = toQuery({ equipment: selectedEquipment, dolibarrRef: selectedDolibarrRef });
    fetch(`/api/dashboard/equipment-lifecycle/part-history?${historyQuery}`)
      .then(res => res.json())
      .then(body => setPartHistory(body.rows ?? []))
      .finally(() => setPartHistoryLoading(false));

    fetch(`/api/dashboard/equipment-lifecycle/comparison?${historyQuery}`)
      .then(res => res.json())
      .then(setComparison)
      .finally(() => setComparisonLoading(false));

    fetch(`/api/dashboard/equipment-lifecycle/insights?${historyQuery}`)
      .then(res => res.json())
      .then(body => setInsights(body.rows ?? []))
      .finally(() => setInsightsLoading(false));
  }, [selectedEquipment, selectedDolibarrRef]);

  // Coincide también por equipment_internal_id cuando está disponible -
  // necesario en modo "Todas", donde `parts` puede traer el mismo
  // dolibarr_ref repetido para máquinas distintas.
  const selectedPartRow = parts.find(
    p => p.dolibarr_ref === selectedDolibarrRef && (!selectedEquipment || p.equipment_internal_id === selectedEquipment)
  ) ?? null;

  // Cambio explícito desde el selector de máquina - sí resetea el
  // repuesto elegido (puede no existir en la máquina nueva).
  function handleEquipmentChange(value: string | undefined) {
    setSelectedEquipment(value);
    setSelectedDolibarrRef(undefined);
  }

  // Clic en una fila de la tabla de repuestos - si estábamos en "Todas",
  // "baja" al filtro de máquina a la de esa fila (no resetea la
  // selección, se elige junto con ella).
  function handleSelectPart(dolibarrRef: string, equipmentInternalId: string | null | undefined) {
    setSelectedDolibarrRef(dolibarrRef);
    if (!selectedEquipment && equipmentInternalId) {
      setSelectedEquipment(equipmentInternalId);
    }
  }

  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard label="Combinaciones máquina-repuesto" value={summary.total_machine_part_combinations} />
          <MetricCard label="Máquinas analizadas" value={summary.total_machines_analyzed} />
          <MetricCard label="Repuestos distintos" value={summary.total_parts_analyzed} />
          <MetricCard label="Clientes analizados" value={summary.total_clients_analyzed} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border p-3" style={{ borderColor: "var(--eyg-border)", background: "var(--eyg-card)" }}>
        <SearchInput
          value={filters.q}
          onSearch={value => setFilters(prev => ({ ...prev, q: value }))}
          placeholder="Buscar cliente, máquina, repuesto, task..."
        />

        <SelectWithAll
          label="Cliente"
          value={filters.client}
          options={(summary?.filterOptions.clientes ?? []).map(c => ({ label: c, value: c }))}
          onChange={value => setFilters(prev => ({ ...prev, client: value }))}
        />

        <SelectWithAll
          label="Confiabilidad"
          value={filters.confidenceLevel}
          options={CONFIDENCE_LEVELS.map(level => ({ label: level, value: level }))}
          onChange={value => setFilters(prev => ({ ...prev, confidenceLevel: value }))}
        />

        <SelectWithAll
          label="Estado de estimación"
          value={filters.estimateStatus}
          options={ESTIMATE_STATUSES.map(s => ({ label: s.label, value: s.value }))}
          onChange={value => setFilters(prev => ({ ...prev, estimateStatus: value }))}
        />

        <SelectWithAll
          allLabel="Auto recomendado"
          value={filters.model}
          options={MODEL_OPTIONS}
          onChange={value => setFilters(prev => ({ ...prev, model: value }))}
          title="Modelo estadístico"
        />

        <input type="date" className="rounded border px-2 py-1.5 text-sm" style={inputStyle} value={filters.from ?? ""} onChange={event => setFilters(prev => ({ ...prev, from: event.target.value || undefined }))} title="Desde" />
        <input type="date" className="rounded border px-2 py-1.5 text-sm" style={inputStyle} value={filters.to ?? ""} onChange={event => setFilters(prev => ({ ...prev, to: event.target.value || undefined }))} title="Hasta" />

        <button type="button" onClick={() => setFilters({})} className="ml-auto rounded-full border px-3 py-1.5 text-xs font-medium" style={{ borderColor: "var(--eyg-border)", color: "var(--text-secondary)" }}>
          Borrar filtros
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>Máquina:</span>
        <EquipmentSelector machines={machines} value={selectedEquipment} onChange={handleEquipmentChange} />
        {machinesLoading && <span className="text-xs" style={{ color: "var(--text-muted)" }}>Cargando máquinas...</span>}
      </div>

      <MachineProfileCard profile={profile} loading={machineDetailLoading} />

      <MachinePartsTable
        parts={parts}
        loading={machineDetailLoading}
        selectedDolibarrRef={selectedDolibarrRef}
        onSelectPart={handleSelectPart}
        showMachineColumn={!selectedEquipment}
      />

      <PartLifecycleCard row={selectedPartRow} />

      <div className="grid gap-4 lg:grid-cols-2">
        <PartHistoryTimeline events={partHistory} loading={partHistoryLoading} />
        <PartComparisonChart data={comparison} loading={comparisonLoading} />
      </div>

      <LifecycleInsightsPanel insights={insights} loading={insightsLoading} />

      <LifecycleEventsTable equipment={selectedEquipment} dolibarrRef={selectedDolibarrRef} client={filters.client} />
    </div>
  );
}
