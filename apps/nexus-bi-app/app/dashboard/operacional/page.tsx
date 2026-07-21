import { PageContainer } from "@/components/ui/PageContainer";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

export const metadata = {
  title: "Dashboard Operacional EyG - Nexus BI"
};

export default function DashboardOperacionalPage() {
  return (
    <PageContainer wide>
      <DashboardShell />
    </PageContainer>
  );
}
