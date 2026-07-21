import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";

export default async function AuditLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireAuthenticatedUser();
  } catch {
    redirect("/login");
  }

  return children;
}
