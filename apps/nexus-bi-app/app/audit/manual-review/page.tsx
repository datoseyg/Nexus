import { Suspense } from "react";
import { PageContainer } from "@/components/ui/PageContainer";
import { AuditManualReviewShell } from "@/components/audit/AuditManualReviewShell";
import { requireAuthenticatedUser } from "@/lib/auth/authorization";

export const metadata = {
  title: "Auditoría y Validación Manual - Nexus BI"
};

export const dynamic = "force-dynamic";

export default async function AuditManualReviewPage() {
  // AuditLayout ya exige sesión válida (redirect a /login si no) - esta
  // llamada adicional solo lee el rol resuelto para pasarlo a la UI (nunca
  // es la autorización real de ningún comando, esa vive server-side en cada
  // ruta de /api/audit/corrections/** vía requireCapability).
  const user = await requireAuthenticatedUser();

  return (
    <PageContainer wide>
      {/* AuditManualReviewShell usa useSearchParams (pestaña activa persistida
          en la URL, mismo patrón que FieldbeatQualityShell/SearchDashboard) -
          exige un límite Suspense alrededor en el árbol de Server Components. */}
      <Suspense fallback={<p style={{ color: "var(--nx-text-secondary)" }}>Cargando…</p>}>
        <AuditManualReviewShell role={user.role} />
      </Suspense>
    </PageContainer>
  );
}
