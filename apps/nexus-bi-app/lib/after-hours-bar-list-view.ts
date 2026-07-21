// Aritmética pura para el bar-list accesible (ETAPA 6.6D) - reemplaza las
// barras SVG de Recharts en los rankings por filas <button> reales con una
// barra proporcional en CSS. Mismo cálculo que
// components/dashboard/MiniBarTableCell.tsx (value/max -> pct), extraído
// acá porque ese componente está pensado para una celda de tabla aislada
// (sin label/aria-label/selección), forma equivocada para un bar-list
// completo con foco de teclado y click-to-filter.

/**
 * @returns porcentaje de ancho de la barra, en [0, 100]. 0 si value<=0 o
 * maxValue<=0 (nunca división por cero ni un ancho negativo); nunca
 * excede 100 aunque value>maxValue.
 */
export function barWidthPct(value: number, maxValue: number): number {
  if (maxValue <= 0 || value <= 0) return 0;
  return Math.min(100, (value / maxValue) * 100);
}

/**
 * @returns el máximo de `values`, o 0 si la lista está vacía o todos los
 * valores son negativos (nunca -Infinity ni un máximo negativo - el
 * máximo de un bar-list siempre acota anchos de barra no-negativos).
 */
export function maxOf(values: number[]): number {
  return Math.max(0, ...values);
}
