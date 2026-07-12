import Link from "next/link";
import { PageContainer } from "@/components/ui/PageContainer";
import { PageHeader } from "@/components/ui/PageHeader";

const SCREENS = [
  {
    href: "/dashboard/fieldbeat",
    title: "Dashboard Operacional FieldBeat",
    description: "KPIs del universo report-céntrico: reportes, repuestos, clientes y equipos."
  },
  {
    href: "/dashboard/operacional",
    title: "Dashboard Operacional (estilo Proyecto 7)",
    description: "Filtros, KPIs, gráficos y tablas de detalle - incluye la pestaña Uptime/Downtime."
  },
  {
    href: "/explorer",
    title: "Explorador de Tablas",
    description: "Navegar cualquiera de las tablas del warehouse, tipo planilla, con paginación y filtro."
  },
  {
    href: "/search",
    title: "Búsqueda / Lupa",
    description: "Buscar reportes técnicos por texto libre (sin IA en este corte)."
  },
  {
    href: "/audit/manual-review",
    title: "Auditoría y Validación Manual",
    description: "Repuestos ambiguos, placeholders, reportes y tickets pendientes de revisión."
  },
  {
    href: "/dashboard/after-hours",
    title: "Trabajo Fuera de Horario",
    description: "Análisis de horas fuera de la ventana hábil configurada, con confiabilidad explícita por KPI. Vista independiente del Dashboard Operacional."
  }
];

const NOT_YET = [
  "Centro de correcciones",
  "Rebuild del pipeline desde la UI",
  "Autenticación / multiusuario",
  "IA local con Ollama",
  "Deploy a Cloudflare"
];

export default function HomePage() {
  return (
    <PageContainer>
      <div className="flex flex-col gap-8">
        <PageHeader
          eyebrow="EyG Medical Systems"
          title="Nexus BI (Fase 1 MVP)"
          description={
            <>
              App local, solo lectura, conectada a <code>data/warehouse/eyg_nexus.duckdb</code>. No modifica RAW,
              PROCESSED, MARTS, GOLD ni la base - ver{" "}
              <a href="../../docs/PRODUCT_APP_ARCHITECTURE.md" style={{ color: "var(--eyg-green-dark)" }}>
                PRODUCT_APP_ARCHITECTURE.md
              </a>
              .
            </>
          }
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SCREENS.map(screen => (
            <Link
              key={screen.href}
              href={screen.href}
              className="rounded-xl border p-4 transition-colors hover:border-current"
              style={{ borderColor: "var(--eyg-border)", background: "var(--eyg-card)", boxShadow: "0 1px 3px rgba(36,48,51,0.07)" }}
            >
              <h2 className="font-semibold" style={{ color: "var(--text-primary)" }}>
                {screen.title}
              </h2>
              <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                {screen.description}
              </p>
            </Link>
          ))}
        </div>

        <div className="rounded-xl border p-4 text-sm" style={{ borderColor: "var(--eyg-border)", background: "var(--eyg-card)" }}>
          <p className="font-medium" style={{ color: "var(--text-primary)" }}>
            Qué NO está implementado todavía en este corte:
          </p>
          <ul className="mt-2 list-disc pl-5" style={{ color: "var(--text-secondary)" }}>
            {NOT_YET.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </PageContainer>
  );
}
