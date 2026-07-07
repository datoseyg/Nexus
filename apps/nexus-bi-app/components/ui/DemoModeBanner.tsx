import { getDataMode } from "@/lib/data-mode";

// Se monta siempre en AppShell - NEXT_PUBLIC_DATA_MODE se inlinea en build
// time, así que no hace falta "use client" ni estado para decidir si se
// muestra. Ver docs/CLOUD_SMOKE_TEST.md y docs/CLOUDFLARE_D1_MIGRATION.md.
export function DemoModeBanner() {
  const mode = getDataMode();
  if (mode === "local-duckdb") return null;

  // Texto de "static" es el literal pedido en la Fase 1 (Cloud Smoke Test) -
  // no tocar. "d1" es el equivalente para la Fase 2 (Cloudflare D1).
  const label = mode === "static" ? "Modo demo cloud read-only · Snapshot estático" : "Modo demo cloud read-only · Cloudflare D1";

  return (
    <div
      className="px-4 py-2 text-center text-sm font-medium"
      style={{ background: "var(--eyg-teal, #0f766e)", color: "#fff" }}
    >
      {label}
    </div>
  );
}
