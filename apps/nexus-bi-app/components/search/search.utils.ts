import { normalizeSearchQuery, resolveQueryAdjustmentMessage, type QueryAdjustmentReason } from "@/lib/search-query-normalizer";
import type { StatusTone } from "@/components/ui/StatusBadge";
import type { SearchEntity } from "@/types/search";

export { normalizeSearchQuery, resolveQueryAdjustmentMessage, type QueryAdjustmentReason };

export const ENTITY_LABELS: Record<SearchEntity, string> = {
  all: "Todos",
  reports: "Reportes",
  tickets: "Tickets",
  clients: "Clientes",
  machines: "Máquinas",
  parts: "Repuestos"
};

export const ENTITY_ORDER: SearchEntity[] = ["all", "reports", "tickets", "clients", "machines", "parts"];

/** "EQUIPO-A|EQUIPO-B" -> ["EQUIPO-A", "EQUIPO-B"] - nunca se muestra el blob crudo. */
export function splitEquipmentIds(value: string | null): string[] {
  if (!value) return [];
  return value.split("|").map(v => v.trim()).filter(Boolean);
}

const TICKET_STATUS_TONE: Record<string, StatusTone> = {
  closed: "success",
  solved: "success",
  open: "info",
  new: "info",
  pending: "warning"
};

export function ticketStatusTone(status: string | null): StatusTone {
  if (!status) return "neutral";
  return TICKET_STATUS_TONE[status.toLowerCase()] ?? "neutral";
}

export function resolveTicketTitle(title: string | null, ticketId: string): string {
  return title && title.trim() ? title : `Ticket #${ticketId}`;
}

export function formatDateEsCl(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("es-CL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
