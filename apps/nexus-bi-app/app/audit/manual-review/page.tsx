import { AppShell } from "@/components/ui/AppShell";
import { AuditManualReviewShell } from "@/components/audit/AuditManualReviewShell";

export const metadata = {
  title: "Auditoría y Validación Manual - Nexus BI"
};

export default function AuditManualReviewPage() {
  return (
    <AppShell wide>
      <AuditManualReviewShell />
    </AppShell>
  );
}
