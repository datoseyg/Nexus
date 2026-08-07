import { PageContainer } from "@/components/ui/PageContainer";
import { FieldbeatQualityShell } from "@/components/fieldbeat/quality/FieldbeatQualityShell";

export const metadata = {
  title: "Dashboard FieldBeat - Nexus BI"
};

export default function FieldBeatDashboardPage() {
  return (
    <PageContainer wide>
      <FieldbeatQualityShell />
    </PageContainer>
  );
}
