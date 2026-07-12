import { PageContainer } from "@/components/ui/PageContainer";
import { AuditManualReviewShell } from "@/components/audit/AuditManualReviewShell";

export const metadata = {
  title: "Auditoría y Validación Manual - Nexus BI"
};

export default function AuditManualReviewPage() {
  return (
    <PageContainer wide>
      <AuditManualReviewShell />
    </PageContainer>
  );
}
