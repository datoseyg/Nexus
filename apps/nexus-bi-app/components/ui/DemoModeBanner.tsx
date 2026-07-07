import { isStaticMode } from "@/lib/data-mode";

// Se monta siempre en AppShell - NEXT_PUBLIC_DATA_MODE se inlinea en build
// time, así que no hace falta "use client" ni estado para decidir si se
// muestra. Ver docs/CLOUD_SMOKE_TEST.md.
export function DemoModeBanner() {
  if (!isStaticMode()) return null;

  return (
    <div
      className="px-4 py-2 text-center text-sm font-medium"
      style={{ background: "var(--eyg-teal, #0f766e)", color: "#fff" }}
    >
      Modo demo cloud read-only · Snapshot estático
    </div>
  );
}
