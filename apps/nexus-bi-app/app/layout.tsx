import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/layout/AppShell";
import { requireAuthenticatedUser } from "@/lib/auth/authorization";

export const metadata: Metadata = {
  title: "Nexus BI - EYG",
  description: "App BI operacional local, Fase 1 MVP (solo lectura)"
};

// Layout raíz: monta el shell de navegación (components/layout/AppShell,
// sidebar/drawer + único <main> de la app) una sola vez, para que Next
// App Router lo reutilice entre rutas sin remontarlo (evita repetir el
// fetch del badge de Auditoría y perder el estado de colapso en cada
// navegación). Cada página sigue eligiendo su propio ancho máximo dentro
// de ese <main> vía components/ui/PageContainer.tsx (`wide` para
// pantallas con grillas de varias columnas como el Dashboard Operacional
// o Auditoría, angosto para el resto) - ver docs/VISUAL_REDESIGN_EYG.md §
// Responsive.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let userLabel: string | null = null;
  try {
    userLabel = (await requireAuthenticatedUser()).label;
  } catch {
    userLabel = null;
  }

  return (
    <html lang="es">
      <body>
        <AppShell
          userLabel={userLabel}
          features={{
            audit: process.env.NEXUS_SHOW_AUDIT === "true",
            explorer: process.env.NEXUS_SHOW_EXPLORER === "true"
          }}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
