/**
 * Decide la acción de versionado comparando SIEMPRE contract_fingerprint
 * (nunca source_row_hash). Si la importación intenta modificar un
 * equipment_key con effective_date <= valid_from de su versión current,
 * es una condición FATAL para toda la corrida (nunca un descarte
 * silencioso de una sola fila) -se devuelve como acción distinta para que
 * el llamador aborte la transacción completa.
 * @param {string} candidateFingerprint
 * @param {{contract_version_id: number, contract_fingerprint: string, valid_from: string} | null} currentVersionRow
 * @param {string} effectiveDate ISO YYYY-MM-DD
 * @returns {{ action: 'NEW' | 'UNCHANGED' | 'SUPERSEDE' | 'FATAL_BACKDATED', reason?: string }}
 */
export function computeVersionAction(candidateFingerprint, currentVersionRow, effectiveDate) {
  if (!currentVersionRow) {
    return { action: "NEW" };
  }

  // valid_from puede ser NULL (ETAPA 6.5.1, versión UNRESOLVED sin fecha
  // conocida) - guard explícito, nunca depender de la coerción implícita de
  // JS (string >= null se compara como NaN >= 0, que da el resultado
  // correcto por accidente, no por diseño).
  if (currentVersionRow.valid_from !== null && effectiveDate <= currentVersionRow.valid_from) {
    return {
      action: "FATAL_BACKDATED",
      reason: `effective_date ${effectiveDate} <= valid_from vigente ${currentVersionRow.valid_from}`
    };
  }

  if (candidateFingerprint === currentVersionRow.contract_fingerprint) {
    return { action: "UNCHANGED" };
  }

  return { action: "SUPERSEDE" };
}
