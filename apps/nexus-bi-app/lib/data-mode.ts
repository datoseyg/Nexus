export type DataMode = "local-duckdb" | "static" | "d1";

const VALID_MODES: readonly DataMode[] = ["local-duckdb", "static", "d1"];

// NEXT_PUBLIC_* se inlinea en build time (server y cliente) - permite que
// tanto Route Handlers como componentes "use client" lean el mismo modo sin
// duplicar lógica. Default "local-duckdb" preserva el comportamiento actual
// de la app cuando la variable no está seteada (dev local de siempre).
export function getDataMode(): DataMode {
  const raw = process.env.NEXT_PUBLIC_DATA_MODE;
  return (VALID_MODES as readonly string[]).includes(raw ?? "") ? (raw as DataMode) : "local-duckdb";
}

export function isStaticMode(): boolean {
  return getDataMode() === "static";
}

export function isLocalDuckDbMode(): boolean {
  return getDataMode() === "local-duckdb";
}

export function isD1Mode(): boolean {
  return getDataMode() === "d1";
}
