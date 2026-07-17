// Resolución contractual de UN equipo FieldBeat para la fecha local de una
// tarea -módulo puro: recibe datos ya consultados (por db-writer.js) y
// aplica la cascada de reason codes cerrada de ETAPA 6.6B0, sin inventar
// tratamiento para ningún caso. Nunca hay señal de criticidad disponible en
// FieldBeat (hallazgo confirmado en el discovery de 6.6A) -CRITICAL_ONLY_24X7
// siempre resuelve a CRITICALITY_UNKNOWN, no calculable.

const NON_ACTIVE_STATUS_REASON = Object.freeze({
  NO_CONTRACT: "NO_CONTRACT_STATUS",
  ON_DEMAND: "ON_DEMAND_UNDEFINED",
  DEINSTALLED: "CONTRACT_STATUS_DEINSTALLED"
});

/**
 * @param {{
 *   fieldbeatEquipmentKey: string,
 *   taskLocalDate: string,
 *   match: { matchStatus: 'MATCHED'|'UNMATCHED'|'AMBIGUOUS', contractEquipmentKey: string|null } | null,
 *   versions: { contractVersionId: number, validFrom: string, validTo: string|null, contractStatusCode: string }[],
 *   scheduleByVersionId: Map<number, { scheduleId: number, coverageType: string, parseStatus: string }>,
 *   windowsByScheduleId: Map<number, { dayOfWeek: string, startMinute: number|null, endMinute: number|null, allDay: boolean }[]>
 * }} input
 * @returns {{
 *   calculable: boolean,
 *   reasonCode: string,
 *   matchStatus: string|null,
 *   contractEquipmentKey: string|null,
 *   contractVersionId: number|null,
 *   scheduleId: number|null,
 *   coverageType: string|null,
 *   parseStatus: string|null,
 *   windows: object[],
 *   validFrom: string|null,
 *   validTo: string|null
 * }}
 */
export function resolveEquipmentContract({ fieldbeatEquipmentKey, taskLocalDate, match, versions, scheduleByVersionId, windowsByScheduleId }) {
  void fieldbeatEquipmentKey;
  const base = { matchStatus: null, matchMethod: null, contractEquipmentKey: null, contractVersionId: null, scheduleId: null, coverageType: null, parseStatus: null, windows: [], validFrom: null, validTo: null };

  // 1) Match.
  if (!match || match.matchStatus === "UNMATCHED") {
    return { ...base, calculable: false, reasonCode: "EQUIPMENT_UNMATCHED", matchStatus: match?.matchStatus ?? "UNMATCHED" };
  }
  if (match.matchStatus === "AMBIGUOUS") {
    return { ...base, calculable: false, reasonCode: "EQUIPMENT_AMBIGUOUS", matchStatus: "AMBIGUOUS" };
  }

  // 2) Versión vigente en la fecha local de la tarea, [valid_from, valid_to).
  // v.validFrom puede ser NULL (ETAPA 6.5.1, versión UNRESOLVED sin fecha
  // conocida) - guard explícito: nunca puede "matchear" una versión sin
  // fecha de inicio real, nunca depender de la coerción implícita de JS.
  const versionAtDate = (versions ?? []).find(v => v.validFrom !== null && taskLocalDate >= v.validFrom && (v.validTo === null || taskLocalDate < v.validTo));
  if (!versionAtDate) {
    return { ...base, calculable: false, reasonCode: "NO_CONTRACT_AT_TASK_DATE", matchStatus: "MATCHED", matchMethod: match.matchMethod ?? null, contractEquipmentKey: match.contractEquipmentKey };
  }

  const withVersion = { ...base, matchStatus: "MATCHED", matchMethod: match.matchMethod ?? null, contractEquipmentKey: match.contractEquipmentKey, contractVersionId: versionAtDate.contractVersionId, validFrom: versionAtDate.validFrom, validTo: versionAtDate.validTo };

  // 3) Estado contractual.
  if (versionAtDate.contractStatusCode in NON_ACTIVE_STATUS_REASON) {
    return { ...withVersion, calculable: false, reasonCode: NON_ACTIVE_STATUS_REASON[versionAtDate.contractStatusCode] };
  }

  // 4) Schedule + parse_status.
  const schedule = scheduleByVersionId.get(versionAtDate.contractVersionId);
  if (!schedule || schedule.parseStatus !== "OK") {
    return { ...withVersion, calculable: false, reasonCode: "SCHEDULE_REVIEW_REQUIRED" };
  }

  const withSchedule = { ...withVersion, scheduleId: schedule.scheduleId, coverageType: schedule.coverageType, parseStatus: schedule.parseStatus };

  // 5) CRITICAL_ONLY_24X7 sin señal de criticidad -nunca hay señal
  // disponible en FieldBeat (hallazgo confirmado, no se inventa una).
  if (schedule.coverageType === "CRITICAL_ONLY_24X7") {
    return { ...withSchedule, calculable: false, reasonCode: "CRITICALITY_UNKNOWN" };
  }

  const windows = windowsByScheduleId.get(schedule.scheduleId) ?? [];
  return { ...withSchedule, calculable: true, reasonCode: "WITHIN_MATCHED_CONTRACT", windows };
}
