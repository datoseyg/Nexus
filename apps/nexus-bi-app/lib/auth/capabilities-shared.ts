// Sin imports server-only (nada de governance-db/pg) - seguro para el bundle
// de cliente. Un componente "use client" nunca decide autorización por el
// nombre del rol (`role === "administracion"`); recibe `capabilities: string[]`
// ya resuelto server-side (ver fetchCapabilitiesForRole en ./capabilities.ts)
// y solo pregunta por la capacidad puntual que ese botón/acción necesita.
export function hasCapability(capabilities: readonly string[], capability: string): boolean {
  return capabilities.includes(capability);
}
