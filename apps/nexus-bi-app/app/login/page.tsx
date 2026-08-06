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
  <div className={styles.brandHeader}>
    <div className={styles.brandMark}>
      <EygBrand
        variant="full"
        priority
        className={styles.brandImage}
      />
    </div>
  </div>

  <div className={styles.contextCopy}>

    <h1 id="login-title">NEXUS</h1>

    <div className={styles.presentationCopy}>
      <p className={styles.description}>
        Plataforma que integra y relaciona en un solo lugar la información de
        EyG Medical Systems, conectando sus principales sistemas:
        <span className={styles.platforms}>
          FieldBeat, Dolibarr y Zendesk.
        </span>
      </p>

      <p className={styles.definition}>
        Nexus es el nexo entre la información, la operación y la toma de
        decisiones del negocio.
      </p>
    </div>
  </div>

  <p className={styles.tagline}>
    Preguntar a los datos nunca fue tan fácil.
  </p>
</div>

        <div className={styles.accessPanel}>
          <div className={styles.accessCopy}>
            <h2>Entra a NEXUS</h2>
            <p>Ingresar credenciales de acceso:</p>
          </div>
          <LoginForm returnTo={safeReturnTo(requestedReturnTo)} />
          <p className={styles.securityNote}>La sesión se valida antes de acceder a páginas y datos por motivos de seguridad.</p>
        </div>
      </section>
    </main>
  );
}
