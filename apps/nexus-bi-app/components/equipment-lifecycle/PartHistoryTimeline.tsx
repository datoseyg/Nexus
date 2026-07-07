import { StatusBadge, matchStatusBadge } from "@/components/ui/StatusBadge";
import type { EquipmentLifecycleEventRow } from "@/types/equipment-lifecycle";

interface PartHistoryTimelineProps {
  events: EquipmentLifecycleEventRow[];
  loading: boolean;
}

// Timeline de fechas de eventos del repuesto seleccionado (Parte 8.5).
export function PartHistoryTimeline({ events, loading }: PartHistoryTimelineProps) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "var(--eyg-border)", background: "var(--eyg-card)" }}>
      <h3 className="mb-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        Historial de eventos
      </h3>

      {loading ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Cargando historial...</p>
      ) : events.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Selecciona un repuesto para ver su historial de eventos.</p>
      ) : (
        <ol className="space-y-3 border-l pl-4" style={{ borderColor: "var(--eyg-border)" }}>
          {events.map(event => {
            const status = matchStatusBadge(event.match_status);
            return (
              <li key={event.lifecycle_event_id} className="relative">
                <span
                  className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full"
                  style={{ background: "var(--eyg-teal, #175f5f)" }}
                />
                <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  {event.event_date ? event.event_date.slice(0, 10) : "fecha desconocida"} - task #{event.fieldbeat_task_id}
                </div>
                <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {event.task_type ?? "-"} · {event.technician_names ?? "sin técnico"} · cantidad {event.quantity ?? "-"}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <StatusBadge label={status.label} tone={status.tone} size="sm" />
                  <StatusBadge label={event.event_type_inferred} tone="neutral" size="sm" />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
