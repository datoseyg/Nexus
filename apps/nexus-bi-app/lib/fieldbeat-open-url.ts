// "Abrir en FieldBeat" (Phase 6, riesgo aceptado 27.B) - construye la URL
// externa autorizada por el propietario:
//   https://teams.fieldbeat.com/#/reportes/tarea?fleet=<fleet>&task_id=<id>&token=<token>
// El host/protocolo/fragmento base son CONSTANTES fijas, nunca derivadas de
// input del usuario - la única superficie variable es fleet/token (config
// server-only, jamás NEXT_PUBLIC_) y taskId (ya validado por
// parseFieldbeatTaskId antes de llegar acá). URLSearchParams codifica cada
// valor de forma segura - nunca concatenación manual de strings no
// confiables.
//
// RISK ACCEPTED — FIELDBEAT ACCESS TOKEN EXPOSED TO AUTHENTICATED USER AGENT
// BY DESIGN: una vez emitido el redirect, el token es visible en la barra
// de direcciones/historial/DevTools del usuario autenticado. Esto es una
// decisión del propietario (27.B), no un descuido - nunca se afirma que el
// token permanece secreto después del redirect.
const FIELDBEAT_OPEN_BASE = "https://teams.fieldbeat.com/#/reportes/tarea";

export interface FieldbeatOpenConfig {
  fleet: string;
  token: string;
}

/**
 * Server-only: FIELDBEAT_FLEET/FIELDBEAT_REPORT_TOKEN. null si falta
 * cualquiera de los dos (o está vacío) - nunca se construye una URL
 * parcial. El llamador NUNCA debe reenviar el objeto retornado al cliente.
 */
export function getFieldbeatOpenConfig(): FieldbeatOpenConfig | null {
  const fleet = process.env.FIELDBEAT_FLEET;
  const token = process.env.FIELDBEAT_REPORT_TOKEN;
  if (!fleet || !token) return null;
  return { fleet, token };
}

/** Para exponer al cliente SOLO este booleano - nunca fleet/token en sí. */
export function isFieldbeatOpenConfigured(): boolean {
  return getFieldbeatOpenConfig() !== null;
}

export interface BuildFieldbeatExternalUrlParams {
  fleet: string;
  token: string;
  taskId: string;
}

export function buildFieldbeatExternalUrl({ fleet, token, taskId }: BuildFieldbeatExternalUrlParams): string {
  const qs = new URLSearchParams({ fleet, task_id: taskId, token });
  return `${FIELDBEAT_OPEN_BASE}?${qs.toString()}`;
}
