import { Suspense } from "react";
import { PageContainer } from "@/components/ui/PageContainer";
import { ExplorerShell } from "@/components/explorer/ExplorerShell";
import { requireAuthenticatedUser } from "@/lib/auth/authorization";
import { fetchCapabilitiesForRole } from "@/lib/auth/capabilities";

// Explorador semántico (Gate B, B20-B23) - reemplaza al Explorador físico
// (browser de schema.tabla vía information_schema, retirado en este cambio
// junto con /api/tables/** y las partes de lib/sql-guardrails.ts que solo
// ese browser usaba). Navegación por entidad de negocio real - clientes,
// equipos, técnicos, reportes, tickets, repuestos, productos, contratos,
// incidencias - cada una con su propia consulta curada, nunca SELECT *.
export const metadata = {
  title: "Explorador - Nexus BI"
};

export const dynamic = "force-dynamic";

export default async function ExplorerPage() {
  // ExplorerLayout ya exige sesión válida - esta lectura adicional solo pasa
  // el rol resuelto a la UI (nunca es la autorización real de ningún
  // comando, esa vive server-side en cada ruta de
  // /api/audit/corrections/** vía requireCapability).
  const user = await requireAuthenticatedUser();
  const capabilities = await fetchCapabilitiesForRole(user.role);

  return (
    <PageContainer wide>
      {/* ExplorerShell usa useSearchParams (entidad/página/búsqueda
          persistidas en la URL, mismo patrón que AuditManualReviewShell) -
          exige un límite Suspense alrededor en el árbol de Server Components. */}
      <Suspense fallback={<p style={{ color: "var(--nx-text-secondary)" }}>Cargando…</p>}>
        <ExplorerShell role={user.role} capabilities={capabilities} />
      </Suspense>
    </PageContainer>
  );
}
