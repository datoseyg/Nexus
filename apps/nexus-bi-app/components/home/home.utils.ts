// Utilidades puras de Inicio, sin dependencia de un endpoint específico -
// separadas de home.types.ts (contratos: tipos + predicates) para
// distinguir "qué forma tiene un dato" de "qué hacemos con un valor ya
// válido".

// Guard reutilizable para campos que representan un conteo: no basta con
// `typeof === "number"` (typeof sigue diciendo "number" para NaN/Infinity
// y para decimales que un consumidor podría redondear en silencio) -
// Number.isSafeInteger() exige un entero exacto y representable.
export function isNonNegativeSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

// Normaliza ultimoCliente: una cadena de solo espacios cuenta como
// ausente, igual que null - decidir "hay dato" nunca debe basarse en una
// cadena en blanco.
export function normalizeClientName(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Formateo entero exacto, sin notación compacta (lib/format.ts no se
// toca; su formatCompactNumber cambia a notación compacta sobre 100.000,
// sin evidencia de diseño para estos KPIs). Recibe un number ya resuelto,
// nunca null - la decisión entre número/skeleton/mensaje de error se hace
// con HomeMetricState antes de llegar acá.
export function formatWholeNumber(value: number): string {
  return new Intl.NumberFormat("es-CL", {
    maximumFractionDigits: 0
  }).format(value);
}
