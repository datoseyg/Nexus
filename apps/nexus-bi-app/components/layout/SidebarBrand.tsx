import Link from "next/link";
import { EygBrand } from "@/components/brand/EygBrand";

interface SidebarBrandProps {
  collapsed: boolean;
}

const BRAND_TOOLTIP = "E&G Medical Systems — Nexus BI";

// Bloque de marca compartido por Sidebar (desktop) y MobileSidebar (drawer
// móvil) - un solo lugar para ambos. Contenedor blanco explícito porque el
// asset (logo y mark) trae fondo blanco propio (ver public/brand/*.webp) y
// el fondo de la sidebar es oscuro (--nx-sidebar-bg): sin este contenedor
// se vería el rectángulo blanco del archivo "pegado" sobre el fondo
// oscuro. aria-label en el <Link> es el ÚNICO mecanismo de nombre
// accesible acá (nunca se agrega además un <span> visualmente oculto con
// el mismo texto - eso duplicaría el nombre para lectores de pantalla,
// ver Fase 6 del encargo); el alt de <EygBrand> queda para el caso en que
// este componente se use fuera de un enlace ya rotulado.
export function SidebarBrand({ collapsed }: SidebarBrandProps) {
  return (
    <Link
      href="/"
      aria-label="Ir al inicio de Nexus BI"
      title={BRAND_TOOLTIP}
      className={`mx-2.5 my-3 flex shrink-0 items-center justify-center rounded-[10px] bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nx-focus-ring-color)] ${
        collapsed ? "h-9 w-9" : "h-14 px-3 py-2"
      }`}
    >
      {collapsed ? (
        <EygBrand variant="mark" priority className="h-7 w-7" />
      ) : (
        <EygBrand variant="full" priority className="h-full w-auto max-w-full" />
      )}
    </Link>
  );
}
