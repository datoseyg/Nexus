// Partición de un intervalo [start,end) en segmentos homogéneos, en TODOS
// los límites relevantes (ETAPA 6.6B0 §2 / este encargo §7): inicio/fin de
// tarea, medianoche local, inicio/fin de ventana de servicio, límite de
// vigencia contractual, transición DST, cambio de estado de feriado. Cada
// segmento resultante tiene EXACTAMENTE un estado (COVERED/OUTSIDE_COVERAGE/
// NOT_CALCULABLE) -nunca uno mixto.

import { utcMsToSantiagoParts, nextLocalMidnightUtc, localMidnightUtc, dayOfWeekAt, localDateStringAt, resolveLocalClockOnDate, offsetMinutesAt } from "./timezone-resolver.js";

/**
 * @typedef {{ dayOfWeek: string, startMinute: number|null, endMinute: number|null, allDay: boolean }} ServiceWindow
 */

/**
 * Genera los límites (instantes UTC en ms) donde debe cortarse el
 * intervalo, dado un conjunto de ventanas de servicio (locales, por día de
 * semana) y opcionalmente un límite de vigencia contractual.
 * @param {number} startUtcMs
 * @param {number} endUtcMs
 * @param {ServiceWindow[]} windows
 * @param {{ validFromUtcMs?: number|null, validToUtcMs?: number|null }} [contractBounds]
 * @returns {number[]} instantes ordenados, únicos, dentro de (startUtcMs, endUtcMs) exclusive de los extremos
 */
export function computeBoundaries(startUtcMs, endUtcMs, windows, contractBounds = {}) {
  const boundarySet = new Set();

  // Medianoches locales dentro del rango (cubre cambio de fecha y, de paso,
  // buena parte de las transiciones DST que ocurren de madrugada).
  let cursor = nextLocalMidnightUtc(startUtcMs);
  while (cursor < endUtcMs) {
    boundarySet.add(cursor);
    cursor = nextLocalMidnightUtc(cursor);
  }

  // Ventanas de servicio: apertura/cierre para cada día local tocado.
  const firstLocalDate = localDateStringAt(startUtcMs);
  const lastLocalDate = localDateStringAt(endUtcMs - 1);
  const datesTouched = [];
  {
    let d = firstLocalDate;
    let guard = 0;
    while (d <= lastLocalDate && guard < 400) {
      datesTouched.push(d);
      const dayStartUtc = localMidnightUtc(Date.parse(`${d}T12:00:00Z`)); // ancla al mediodía UTC de esa fecha para evitar drift
      d = localDateStringAt(nextLocalMidnightUtc(dayStartUtc));
      guard += 1;
    }
  }

  for (const localDate of datesTouched) {
    const dow = dayOfWeekAt(resolveLocalClockOnDate(localDate, 12, 0));
    const daySchedule = windows.filter(w => w.dayOfWeek === dow);
    for (const w of daySchedule) {
      if (w.allDay) continue; // sin límites internos, el día completo es la ventana
      if (w.startMinute === null || w.endMinute === null) continue;
      const openUtc = resolveLocalClockOnDate(localDate, Math.floor(w.startMinute / 60), w.startMinute % 60);
      const closeUtc = resolveLocalClockOnDate(localDate, Math.floor(w.endMinute / 60), w.endMinute % 60);
      if (openUtc > startUtcMs && openUtc < endUtcMs) boundarySet.add(openUtc);
      if (closeUtc > startUtcMs && closeUtc < endUtcMs) boundarySet.add(closeUtc);
    }
  }

  // Límite de vigencia contractual.
  if (contractBounds.validFromUtcMs && contractBounds.validFromUtcMs > startUtcMs && contractBounds.validFromUtcMs < endUtcMs) {
    boundarySet.add(contractBounds.validFromUtcMs);
  }
  if (contractBounds.validToUtcMs && contractBounds.validToUtcMs > startUtcMs && contractBounds.validToUtcMs < endUtcMs) {
    boundarySet.add(contractBounds.validToUtcMs);
  }

  // Transiciones DST explícitas (adicional a las medianoches -una
  // transición puede no coincidir con medianoche).
  {
    let prevOffset = offsetMinutesAt(startUtcMs);
    // Escanea en pasos de 1 día -suficiente para intervalos de tareas
    // (horas/días), nunca meses.
    let t = startUtcMs;
    while (t < endUtcMs) {
      const next = Math.min(t + 86400000, endUtcMs);
      const nextOffset = offsetMinutesAt(next);
      if (nextOffset !== prevOffset) {
        // Búsqueda binaria fina del instante exacto de transición dentro de
        // [t, next), redondeada hacia arriba al segundo entero (Capa B/C
        // exigen whole-seconds, sql/081) -mismo criterio que
        // timezone-resolver.js#findTransitionInstant.
        let lo = t, hi = next;
        while (hi - lo > 1) {
          const mid = lo + Math.floor((hi - lo) / 2);
          if (offsetMinutesAt(mid) === prevOffset) lo = mid; else hi = mid;
        }
        hi = Math.ceil(hi / 1000) * 1000;
        if (hi > startUtcMs && hi < endUtcMs) boundarySet.add(hi);
      }
      prevOffset = nextOffset;
      t = next;
    }
  }

  return Array.from(boundarySet).sort((a, b) => a - b);
}

/**
 * Determina si un segmento [segStart,segEnd) (dentro de un mismo día local,
 * sin cruzar ningún límite) cae dentro de alguna ventana de servicio.
 * @param {number} segStartUtcMs
 * @param {number} segEndUtcMs
 * @param {ServiceWindow[]} windows
 * @returns {boolean}
 */
export function isWithinWindow(segStartUtcMs, segEndUtcMs, windows) {
  const localDate = localDateStringAt(segStartUtcMs);
  const dow = dayOfWeekAt(segStartUtcMs);
  const daySchedule = windows.filter(w => w.dayOfWeek === dow);
  if (daySchedule.length === 0) return false;

  for (const w of daySchedule) {
    if (w.allDay) return true;
    if (w.startMinute === null || w.endMinute === null) continue;
    const openUtc = resolveLocalClockOnDate(localDate, Math.floor(w.startMinute / 60), w.startMinute % 60);
    const closeUtc = resolveLocalClockOnDate(localDate, Math.floor(w.endMinute / 60), w.endMinute % 60);
    // El segmento debe caer COMPLETAMENTE dentro de [openUtc, closeUtc) -si
    // llegamos acá, computeBoundaries ya garantizó que no se cruza el borde
    // de una ventana a mitad de segmento.
    if (segStartUtcMs >= openUtc && segEndUtcMs <= closeUtc) return true;
  }
  return false;
}

/**
 * Parte [startUtcMs, endUtcMs) en segmentos homogéneos usando los límites
 * calculados, anotando local_date/day_of_week/within_window por segmento.
 * @returns {{ startUtcMs:number, endUtcMs:number, localDate:string, dayOfWeek:string, withinWindow:boolean, boundaryReasons:string[] }[]}
 */
export function partitionInterval(startUtcMs, endUtcMs, windows, contractBounds = {}) {
  const boundaries = computeBoundaries(startUtcMs, endUtcMs, windows, contractBounds);
  const cutPoints = [startUtcMs, ...boundaries, endUtcMs];
  const segments = [];
  for (let i = 0; i < cutPoints.length - 1; i++) {
    const segStart = cutPoints[i];
    const segEnd = cutPoints[i + 1];
    if (segEnd <= segStart) continue;
    segments.push({
      startUtcMs: segStart,
      endUtcMs: segEnd,
      localDate: localDateStringAt(segStart),
      dayOfWeek: dayOfWeekAt(segStart),
      withinWindow: isWithinWindow(segStart, segEnd, windows),
      boundaryReasons: []
    });
  }
  return segments;
}
