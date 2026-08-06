import { redirect } from "next/navigation";
import { Brand } from "@/components/ui/Brand";
import { requireAuthenticatedUser } from "@/lib/auth/authorization";
import { safeReturnTo } from "@/lib/auth/return-to";
import { LoginForm } from "./LoginForm";
import styles from "./login.module.css";
import { EygBrand } from "@/components/brand/EygBrand";

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
            <EygBrand variant="mark" priority className="h-7 w-7" />
          </div>

          <div className={styles.contextCopy}>
            <h1 id="login-title">NEXUS</h1>
            <p>
              Proyecto que integra y relaciona la información de EyG Medical Systems en un sólo lugar,
              unificando las principales plataformas (FieldBeat, Dolibarr, Zendesk) y ofrec
            </p>
          </div>

        </div>

        <div className={styles.accessPanel}>
          <div className={styles.accessCopy}>
            <p className={styles.eyebrow}>Acceso controlado</p>
            <h2>Entra a NEXUS</h2>
            <p>Ingresar credenciales de acceso.</p>
          </div>
          <LoginForm returnTo={safeReturnTo(requestedReturnTo)} />
          <p className={styles.securityNote}>La sesión se valida antes de acceder a páginas y datos.</p>
        </div>
      </section>
    </main>
  );
}
