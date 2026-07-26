// Universo cerrado de FieldBeat. Fuente: reconciliación contra Postgres
// local (processed.fieldbeat_tasks.state, 3.747 filas, 24-jul-2026) - los 9
// valores reales observados son FINISHED(3415) ARCHIVED(194) SCHEDULED(89)
// STARTED(21) SENT(11) PAUSED(10) ON_ROUTE(4) CONTINUED(2) ASSIGNED(1).
// FINISHED+ARCHIVED = 3.609, exactamente el "cerrado" heredado de Gate A.
// Ningún otro estado observado es terminal - no se infieren equivalentes.

export const KNOWN_FIELDBEAT_TASK_STATES = [
  "FINISHED",
  "ARCHIVED",
  "SCHEDULED",
  "STARTED",
  "SENT",
  "PAUSED",
  "ON_ROUTE",
  "CONTINUED",
  "ASSIGNED"
] as const;

export type KnownFieldbeatTaskState = (typeof KNOWN_FIELDBEAT_TASK_STATES)[number];

export const TERMINAL_FIELDBEAT_TASK_STATES = ["FINISHED", "ARCHIVED"] as const;

export type TerminalFieldbeatTaskState = (typeof TERMINAL_FIELDBEAT_TASK_STATES)[number];

const TERMINAL_STATE_SET: ReadonlySet<string> = new Set(TERMINAL_FIELDBEAT_TASK_STATES);
const KNOWN_STATE_SET: ReadonlySet<string> = new Set(KNOWN_FIELDBEAT_TASK_STATES);

export function isKnownFieldbeatTaskState(state: string): state is KnownFieldbeatTaskState {
  return KNOWN_STATE_SET.has(state);
}

/**
 * Un estado desconocido (no observado en la reconciliación) nunca cuenta
 * como cerrado por defecto - evita inflar el universo cerrado con un
 * estado nuevo no auditado. Ver isKnownFieldbeatTaskState() para detectar
 * ese caso por separado y no ocultarlo.
 */
export function isTerminalFieldbeatTaskState(state: string): state is TerminalFieldbeatTaskState {
  return TERMINAL_STATE_SET.has(state);
}
