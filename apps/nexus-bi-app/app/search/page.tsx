import { Suspense } from "react";
import { PageContainer } from "@/components/ui/PageContainer";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchDashboard } from "@/components/search/SearchDashboard";

export const metadata = {
  title: "Búsqueda - Nexus BI"
};

// Fija los tokens heredados por componentes reutilizados sin editar
// (ErrorBanner, EmptyState, PaginationControls - todos fuera del alcance
// de esta etapa) a sus valores claros de forma explícita, igual que en
// Inicio/Dashboard Operacional, para evitar el mismo bug de contraste bajo
// prefers-color-scheme: dark del sistema.
const SHELL_STYLE = {
  background: "var(--nx-page-bg)",
  boxShadow: "var(--nx-shadow-shell)",
  "--eyg-card": "#ffffff",
  "--eyg-border": "#dde6e3",
  "--eyg-green-dark": "#3c8c2e",
  "--eyg-danger": "#d9534f",
  "--surface-1": "#ffffff",
  "--page-plane": "#f4f7f6",
  "--text-primary": "#243033",
  "--text-secondary": "#5e6b70",
  "--text-muted": "#8a9a95",
  "--border": "#dde6e3",
  "--status-critical": "#d9534f"
} as React.CSSProperties;

// Server Component delgado: el encabezado no depende de ningún fetch y se
// renderiza de inmediato (garantiza que el marcador de scripts/smoke.mjs
// esté presente en el primer HTML, sin depender de la hidratación).
// SearchDashboard es el único límite "use client" - usa useSearchParams(),
// que exige un <Suspense> alrededor en el árbol de Server Components.
export default function SearchPage() {
  return (
    <PageContainer wide>
      <div className="overflow-hidden rounded-[var(--nx-radius-shell)]" style={SHELL_STYLE}>
        <div className="p-5 sm:p-7" style={{ background: "var(--nx-card-bg)", borderBottom: "1px solid var(--nx-border)" }}>
          <PageHeader
            title="Búsqueda"
            description="Encuentra reportes, tickets, clientes, máquinas y repuestos con datos reales de Nexus."
          />
        </div>
        <div className="p-5 sm:p-7">
          <Suspense fallback={<p style={{ color: "var(--nx-text-secondary)" }}>Cargando búsqueda…</p>}>
            <SearchDashboard />
          </Suspense>
        </div>
      </div>
    </PageContainer>
  );
}
