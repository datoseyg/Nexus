import Link from "next/link";
import { PageContainer } from "@/components/ui/PageContainer";
import { PageHeader } from "@/components/ui/PageHeader";
import { HomeNavigationGrid } from "@/components/home/HomeNavigationGrid";
import { HomeDashboard } from "@/components/home/HomeDashboard";
import { requireAuthenticatedUser } from "@/lib/auth/authorization";
import { redirect } from "next/navigation";

const TOOLS = [
  { href: "/explorer", title: "Explorador", description: "Consulta libre de las tablas internas del warehouse.", feature: "explorer" as const },
  { href: "/search", title: "Búsqueda", description: "Búsqueda técnica de reportes por palabras clave." }
];

// Superficie secundaria del standalone (#f7f8fb) para "Herramientas
// internas" - no existe un token --nx-* que represente exactamente este
// valor; se usa el literal local en vez de agregar un token global nuevo
// solo para esta corrección (ver mismo criterio en HomeDataStatus.tsx).
const TOOL_CARD_BG = "#f7f8fb";

// Server Component: el encabezado, los accesos principales
// (HomeNavigationGrid) y "Herramientas internas" no dependen de ningún
// fetch y se renderizan de inmediato. HomeDashboard es el único límite
// "use client" de la página - posee las 4 llamadas a los endpoints reales
// (audit/summary, dashboard/operacional/summary, dashboard/fieldbeat,
// dashboard/after-hours/summary) y sus estados independientes.
//
// Corrección de fidelidad visual (referencia: docs/design-revolution/
// Nexus - Inicio - standalone.html, script[type="__bundler/template"]):
// el lienzo de contenido de Inicio se fija a --nx-page-bg (#eef0f4) de
// forma explícita en vez de heredar el fondo de <body> (--page-plane,
// que resuelve a --eyg-bg y SÍ tiene una variante oscura vía
// prefers-color-scheme: dark). Sin este fondo propio, un visitante con
// tema oscuro del sistema ve el lienzo casi negro (#131a17) mientras el
// texto de las secciones (tokens --nx-text-* de components/home/**, sin
// variante oscura por diseño) se mantiene oscuro - texto oscuro sobre
// fondo oscuro. --nx-page-bg no depende de prefers-color-scheme, así que
// fijarlo acá hace que Inicio se vea igual (claro) sin importar el tema
// del sistema, sin tocar app/globals.css ni afectar otras rutas.
//
// PageHeader (reutilizado sin editar su archivo) lee --eyg-green-dark/
// --text-primary/--text-secondary, que sí tienen variante oscura - se
// sobrescriben esas 3 custom properties únicamente en el scope de este
// wrapper (mecanismo estándar de cascada CSS - React.CSSProperties no
// tipa custom properties arbitrarias, de ahí el cast puntual a ese mismo
// tipo, sin relación con los guards runtime de HomeDashboard.tsx) para
// que el header, ahora con fondo blanco explícito, quede siempre con
// texto oscuro legible, sin depender del tema del sistema y sin
// modificar components/ui/PageHeader.tsx.
const SHELL_STYLE = {
  background: "var(--nx-page-bg)",
  boxShadow: "var(--nx-shadow-shell)",
  "--eyg-green-dark": "#3c8c2e",
  "--text-primary": "#243033",
  "--text-secondary": "#5e6b70"
} as React.CSSProperties;

export default async function HomePage() {
  try {
    await requireAuthenticatedUser();
  } catch {
    redirect("/login");
  }

  const showAudit = process.env.NEXUS_SHOW_AUDIT === "true";
  const showExplorer = process.env.NEXUS_SHOW_EXPLORER === "true";
  const visibleTools = TOOLS.filter(tool => showExplorer || tool.feature !== "explorer");

  return (
    <PageContainer wide>
      <div className="overflow-hidden rounded-[var(--nx-radius-shell)]" style={SHELL_STYLE}>
        <div
          className="p-5 sm:p-7"
          style={{ background: "var(--nx-card-bg)", borderBottom: "1px solid var(--nx-border)" }}
        >
          <PageHeader
            eyebrow="EyG Medical Systems"
            title="Bienvenido a Nexus"
            description="Nexus reúne en un mismo lugar la información de servicio técnico (FieldBeat), tickets de soporte (Zendesk) y repuestos utilizados (Dolibarr), para poder revisar el estado de cada área desde un solo lugar."
          />
        </div>

        <div className="flex flex-col gap-6 p-5 sm:p-7">
          <HomeDashboard navigationSlot={<HomeNavigationGrid showAudit={showAudit} />} />

          <section>
            <h2
              className="mb-2 text-xs font-bold uppercase tracking-wide"
              style={{ color: "var(--nx-text-muted)" }}
            >
              Herramientas internas
            </h2>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {visibleTools.map(tool => (
                <li key={tool.href}>
                  <Link
                    href={tool.href}
                    className="flex min-w-0 flex-col gap-1 rounded-[var(--nx-radius-card)] border p-3.5"
                    style={{ background: TOOL_CARD_BG, borderColor: "var(--nx-border)" }}
                  >
                    <span className="text-sm font-semibold" style={{ color: "var(--nx-text-secondary)" }}>
                      {tool.title}
                    </span>
                    <span className="break-words text-xs" style={{ color: "var(--nx-text-muted)" }}>
                      {tool.description}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </PageContainer>
  );
}
