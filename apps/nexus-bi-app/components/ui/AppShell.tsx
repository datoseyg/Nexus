import { NavBar } from "@/components/NavBar";

interface AppShellProps {
  children: React.ReactNode;
  wide?: boolean;
}

// Envoltorio de página compartido por toda la app: NavBar + contenedor
// centrado sobre el fondo E&G (--page-plane). `wide` amplía el ancho
// máximo para pantallas con grillas de 12 columnas (Dashboard, Auditoría)
// — el resto de las pantallas (Explorer, Search, landing) usa el ancho
// angosto original. Ver docs/VISUAL_REDESIGN_EYG.md.
export function AppShell({ children, wide = false }: AppShellProps) {
  return (
    <>
      <NavBar />
      <main className={`mx-auto ${wide ? "max-w-[1400px]" : "max-w-6xl"} px-4 py-6`}>{children}</main>
    </>
  );
}
