import Link from "next/link";
import { Brand } from "@/components/ui/Brand";

interface SidebarBrandProps {
  collapsed: boolean;
}

// Bloque de marca compartido por Sidebar (desktop) y MobileSidebar (drawer
// móvil). Usa <Brand/> ya existente (badge "EyG" heredado, no logo oficial
// - ver components/ui/Brand.tsx) en vez de duplicar el markup inline que
// tenía NavBar.tsx.
export function SidebarBrand({ collapsed }: SidebarBrandProps) {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2.5 py-3">
      <Brand />
      <span
        className={`text-[15px] font-extrabold ${collapsed ? "sr-only" : ""}`}
        style={{ color: "var(--nx-sidebar-text-primary)" }}
      >
        Nexus BI
      </span>
    </Link>
  );
}
