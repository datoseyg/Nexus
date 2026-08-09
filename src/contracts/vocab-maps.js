// Vocabularios controlados -valores raw REALES observados en las 23 filas de
// equipo del CSV fuente (ver plan ETAPA 6.5, sección "Vocabularios
// controlados"). Deben mantenerse en lockstep con los CHECK de
// sql/070_config.sql. Cualquier valor no listado acá cae a UNKNOWN vía
// lookup-normalizer.js + issue UNMAPPED_ENUM_VALUE (código adicional,
// justificado por el encargo).

export const CONTRACT_STATUS_MAP = {
  "Vigente (Ren. Automática) (E&G)": "ACTIVE_AUTO_RENEW",
  "Vigente (Plazo Fijo) (E&G)": "ACTIVE_FIXED_TERM",
  "Garantía con Elekta": "WARRANTY_ELEKTA",
  "Directo con Elekta": "DIRECT_WITH_ELEKTA",
  "Sin Contrato": "NO_CONTRACT",
  "Contrato On Demand (E&G)": "ON_DEMAND",
  "On Demand (Sin Contrato)": "ON_DEMAND",
  // Typo real del CSV fuente -corregido únicamente acá, en el código
  // normalizado. contract_status_raw conserva "Desintalado" tal cual.
  "Desintalado": "DEINSTALLED",
  "Equipo Desinstalado": "DEINSTALLED"
};

export const SPA_TIER_MAP = {
  "Gold (Incluye todos los repuestos)": "GOLD",
  "Garantía Elekta (Todo incluído)": "WARRANTY_FULL",
  "Silver (Sólo Soporte)": "SILVER",
  "Garantía Elekta (Gold)": "WARRANTY_GOLD",
  "Sin SPA (Fuera registros Elekta)": "NO_SPA",
  "Silver + 3 Fuentes Ir-192": "SILVER_WITH_SOURCES",
  "Silver sin Fuente": "SILVER_NO_SOURCE"
};

export const SUPPORT_MODE_MAP = {
  "Presencial y Remoto": "ONSITE_AND_REMOTE",
  "Remoto": "REMOTE",
  "N/A": "NOT_APPLICABLE"
};

export const PARTS_COVERAGE_MAP = {
  "Todo Incluído": "FULL_COVERAGE",
  // Variante ortográfica real de la fuente conservadora 2026-08-04.
  "Todo Incluido": "FULL_COVERAGE",
  // Hallazgo de verificación contra el archivo real (Clínica Las Condes
  // CLC1/CLC2): misma cobertura completa, con nota de que el contrato es
  // directo con Elekta -no amerita un código de cobertura distinto.
  "Todo Incluído (Contrato directo con Elekta)": "FULL_COVERAGE",
  "Todos, Excepto Paneles, Magnetron y Thyratron": "PARTIAL_EXCLUDES_PANELS_MAGNETRON_THYRATRON",
  "No Incluídos": "NOT_INCLUDED",
  "No Incluidos": "NOT_INCLUDED",
  "Incluye sólo repuestos bajo USD 1500.- (NO incluye fuente)": "PARTIAL_UNDER_THRESHOLD"
};

// Vocabulario compartido por HW Refresh / UpDates / UpGrades -las 3
// columnas usan el mismo conjunto real de valores (ver discovery gate).
export const YES_NO_SW_MAP = {
  "Sí": "YES",
  "No": "NO",
  "Sólo SW": "SW_ONLY",
  "Sólo si el nuevo SW lo requiere": "CONDITIONAL_SW"
};
