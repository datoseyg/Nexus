import { PageContainer } from "@/components/ui/PageContainer";
import { AfterHoursShell } from "@/components/after-hours/AfterHoursShell";

export const metadata = {
  title: "Trabajo Fuera de Horario - Nexus BI"
};

// Vista independiente (no una sección de /dashboard/operacional). ETAPA
// 6.6D: reconstrucción fiel de
// docs/design-revolution/Claude-Designs/Nexus - Trabajo Fuera de
// Horario.dc.html - AfterHoursShell reproduce el "shell" completo (header
// + banner + filtros + KPI + secciones + tabla + drawer), mismo patrón que
// components/dashboard/DashboardShell.tsx para /dashboard/operacional. El
// sidebar global vive en components/layout/AppShell.tsx, no se duplica acá.
export default function AfterHoursPage() {
  return (
    <PageContainer wide>
      <AfterHoursShell />
    </PageContainer>
  );
}
