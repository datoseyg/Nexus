import { PageContainer } from "@/components/ui/PageContainer";
import { FieldbeatShell } from "@/components/fieldbeat/FieldbeatShell";

export const metadata = {
  title: "Dashboard FieldBeat - Nexus BI"
};

export default function FieldBeatDashboardPage() {
  return (
    <PageContainer wide>
      <FieldbeatShell />
    </PageContainer>
  );
}
