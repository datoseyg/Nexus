import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nexus BI - EYG",
  description: "App BI operacional local, Fase 1 MVP (solo lectura)"
};

// Layout raíz mínimo a propósito: cada página monta su propio <AppShell>
// (ver components/ui/AppShell.tsx) para poder elegir su ancho máximo
// (`wide` para pantallas con grillas de varias columnas como el Dashboard
// Operacional o Auditoría, angosto para el resto) - un layout raíz con un
// contenedor fijo no permite esa variación por ruta. Ver
// docs/VISUAL_REDESIGN_EYG.md § Responsive.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
