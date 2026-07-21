import { EygBrand } from "@/components/brand/EygBrand";

interface MobileTopBarProps {
  mobileOpen: boolean;
  onOpenMenu: () => void;
  menuButtonRef: React.RefObject<HTMLButtonElement | null>;
  mobileSidebarId: string;
}

// Barra superior visible solo <md (Sidebar cubre >=md, ver Sidebar.tsx).
// El botón hamburguesa recibe la ref explícita que AppShell reenvía a
// MobileSidebar para restaurar el foco al cerrar (returnFocusRef) - ver
// comentario en components/layout/MobileSidebar.tsx.
export function MobileTopBar({ mobileOpen, onOpenMenu, menuButtonRef, mobileSidebarId }: MobileTopBarProps) {
  return (
    <header
      className="nx-shell-chrome sticky top-0 z-10 flex items-center gap-2.5 border-b px-3 py-2.5 md:hidden"
      style={{ background: "var(--nx-sidebar-bg)", borderColor: "rgba(255,255,255,0.08)" }}
    >
      <button
        ref={menuButtonRef}
        type="button"
        onClick={onOpenMenu}
        aria-label="Abrir menú"
        aria-expanded={mobileOpen}
        aria-controls={mobileSidebarId}
        className="flex h-9 w-9 items-center justify-center rounded-[var(--nx-radius-button)]"
        style={{ color: "var(--nx-sidebar-text-primary)" }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17" />
        </svg>
      </button>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-white" title="E&G Medical Systems — Nexus BI">
        <EygBrand variant="mark" className="h-6 w-6" />
      </span>
      <span className="sr-only">Nexus BI</span>
    </header>
  );
}
