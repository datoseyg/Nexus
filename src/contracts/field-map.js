// Layout posicional real de data/manual/contracts/Detalles Contractuales EyG.xlsx -
// Clientes (2).csv, confirmado por lectura directa del archivo (ver plan ETAPA 6.5).
// El header trae 6 columnas sin nombre entre "Notas" y "Variables(no considerar
// para analisis)" -eso impide csv-parse en modo columns:true (headers duplicados
// vacíos), por lo que este CSV se parsea siempre posicionalmente (columns:false).

export const COLUMN = Object.freeze({
  CLIENTE: 0,
  ABREVIACION: 1,
  EQUIPO: 2,
  SERIE: 3,
  ANIO_INSTALACION: 4,
  ESTADO_CONTRATO: 5,
  SPA_ELEKTA: 6,
  LUN_VIE: 7,
  SAB_DOM: 8,
  SOPORTE_ELEKTA: 9,
  HORARIOS_ATENCION: 10,
  HW_REFRESH: 11,
  UPDATES: 12,
  UPGRADES: 13,
  SITUACION_REPUESTOS: 14,
  Q_MANT_PREV_ANIO: 15,
  NOTAS: 16
  // 17-22: columnas espaciadoras sin nombre, siempre ignoradas.
  // 23 (VARIABLES): "Variables(no considerar para analisis)" -siempre ignorada,
  // en toda fila, aparezca donde aparezca (incluso en filas de equipo reales).
});

export const VARIABLES_COLUMN_INDEX = 23;

// Cantidad mínima de columnas que debe tener cada fila parseada para que el
// layout se considere íntegro. El archivo real tiene 24 columnas (0-23); se
// exige un mínimo de 17 (0-16, hasta Notas) porque algunas filas de equipo
// reales terminan antes del bloque de espaciadores (csv-parse rellena con
// "" las columnas faltantes solo si header tiene el mismo largo; validamos
// igual por robustez ante archivos futuros).
export const MIN_EXPECTED_COLUMNS = 17;

const EXPECTED_HEADER_PREFIX = [
  "Cliente",
  "Abreviación",
  "Equipo",
  "S-N",
  "Año Instalación",
  "Estado Contrato",
  "SPA con Elekta",
  "Lun - Vie",
  "Sab - Dom",
  "Soporte Elekta",
  "Horarios de Atención",
  "HW Refresh",
  "UpDates",
  "UpGrades",
  "Situación Repuestos",
  "Q Mant Prev x Año",
  "Notas"
];

/**
 * Valida que la fila de header real coincida con el layout posicional
 * esperado (0-16). No exige nada sobre las columnas 17+ (espaciadores/
 * Variables), que son deliberadamente sin nombre o irrelevantes.
 * @param {string[]} headerRow
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function assertHeaderShape(headerRow) {
  if (!Array.isArray(headerRow) || headerRow.length < EXPECTED_HEADER_PREFIX.length) {
    return { ok: false, reason: `Header con ${headerRow?.length ?? 0} columnas, se esperaban al menos ${EXPECTED_HEADER_PREFIX.length}.` };
  }

  for (let i = 0; i < EXPECTED_HEADER_PREFIX.length; i++) {
    if ((headerRow[i] ?? "").trim() !== EXPECTED_HEADER_PREFIX[i]) {
      return {
        ok: false,
        reason: `Columna ${i} esperada "${EXPECTED_HEADER_PREFIX[i]}", encontrada "${headerRow[i]}".`
      };
    }
  }

  return { ok: true };
}

export const FIELD_NAMES_FOR_STORAGE = Object.freeze({
  [COLUMN.CLIENTE]: "cliente_raw",
  [COLUMN.ABREVIACION]: "abreviacion_raw",
  [COLUMN.EQUIPO]: "equipo_raw",
  [COLUMN.SERIE]: "serie_raw",
  [COLUMN.ANIO_INSTALACION]: "anio_instalacion_raw",
  [COLUMN.ESTADO_CONTRATO]: "estado_contrato_raw",
  [COLUMN.SPA_ELEKTA]: "spa_elekta_raw",
  [COLUMN.LUN_VIE]: "lun_vie_raw",
  [COLUMN.SAB_DOM]: "sab_dom_raw",
  [COLUMN.SOPORTE_ELEKTA]: "soporte_elekta_raw",
  [COLUMN.HORARIOS_ATENCION]: "horarios_atencion_raw",
  [COLUMN.HW_REFRESH]: "hw_refresh_raw",
  [COLUMN.UPDATES]: "updates_raw",
  [COLUMN.UPGRADES]: "upgrades_raw",
  [COLUMN.SITUACION_REPUESTOS]: "situacion_repuestos_raw",
  [COLUMN.Q_MANT_PREV_ANIO]: "q_mant_prev_anio_raw",
  [COLUMN.NOTAS]: "notas_raw"
});
