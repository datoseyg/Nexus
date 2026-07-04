import { AppShell } from "@/components/ui/AppShell";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

export const metadata = {
  title: "Dashboard Operacional EyG - Nexus BI"
};

export default function DashboardOperacionalPage() {
  return (
    <AppShell wide>
      <DashboardShell />
    </AppShell>
  );
}
