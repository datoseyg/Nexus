import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/layout/AppShell";

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
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
