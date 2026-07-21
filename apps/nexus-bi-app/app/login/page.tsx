import { redirect } from "next/navigation";
import { Brand } from "@/components/ui/Brand";
import { requireAuthenticatedUser } from "@/lib/auth/authorization";
import { safeReturnTo } from "@/lib/auth/return-to";
import { LoginForm } from "./LoginForm";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Acceso seguro - NEXUS"
};

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  let authenticated = false;
  try {
    await requireAuthenticatedUser();
    authenticated = true;
  } catch {
    authenticated = false;
  }

  if (authenticated) redirect("/");

  const params = await searchParams;
  const requestedReturnTo = typeof params.next === "string" ? params.next : null;

  return (
    <main className={styles.page}>
      <section className={styles.portal} aria-labelledby="login-title">
        <div className={styles.context}>
          <div className={styles.brandLine}>
            <Brand />
            <span>EyG Medical Systems</span>
          </div>

          <div className={styles.contextCopy}>
            <p className={styles.eyebrow}>Portal empresarial</p>
            <h1 id="login-title">NEXUS</h1>
            <p>
              Información operacional de servicio técnico, soporte y repuestos en un entorno protegido.
            </p>
          </div>

          <div className={styles.dataRail} aria-hidden="true">
            <span>Servicio técnico</span>
            <span>Soporte</span>
            <span>Repuestos</span>
            <i />
          </div>
        </div>

        <div className={styles.accessPanel}>
          <div className={styles.accessCopy}>
            <p className={styles.eyebrow}>Acceso controlado</p>
            <h2>Ingresa a NEXUS</h2>
            <p>Utiliza la identidad asignada por EyG para consultar la información disponible.</p>
          </div>
          <LoginForm returnTo={safeReturnTo(requestedReturnTo)} />
          <p className={styles.securityNote}>La sesión se valida antes de acceder a páginas y datos.</p>
        </div>
      </section>
    </main>
  );
}
