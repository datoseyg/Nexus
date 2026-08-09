import { SidebarBrand } from "@/components/layout/SidebarBrand";
import { SidebarNavigation } from "@/components/layout/SidebarNavigation";
import { UserSessionControls } from "@/components/layout/UserSessionControls";
import { DataRefreshControl } from "@/components/data-refresh/DataRefreshControl";
import { BUTTON_CHROME } from "@/components/ui/interactive";

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  pendingReviewCount: number | null;
  userLabel: string;
  features: { audit: boolean; explorer: boolean };
  capabilities: string[];
}

// Sidebar fija de desktop (oculta <md, ver MobileTopBar/MobileSidebar para
// el equivalente móvil). Ancho controlado por --nx-sidebar-width-*; la
// única transición real de esta etapa (motion-reduce respetado vía el
// variant de Tailwind, sin config adicional).
export function Sidebar({ collapsed, onToggleCollapse, pendingReviewCount, userLabel, features, capabilities }: SidebarProps) {
  return (
    <aside
      className="nx-shell-chrome sticky top-0 hidden h-screen shrink-0 flex-col overflow-y-auto transition-[width] duration-200 ease-out motion-reduce:transition-none md:flex"
      style={{
        width: collapsed ? "var(--nx-sidebar-width-collapsed)" : "var(--nx-sidebar-width-expanded)",
        background: "var(--nx-sidebar-bg)"
      }}
    >
      <SidebarBrand collapsed={collapsed} />
      <div className="flex-1">
        <SidebarNavigation collapsed={collapsed} pendingReviewCount={pendingReviewCount} features={features} />
      </div>
      <div className="px-2.5 py-3">
        <UserSessionControls label={userLabel} compact={collapsed} />
        <DataRefreshControl capabilities={capabilities} compact={collapsed} />
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
          className={`mt-2 flex w-full items-center justify-center gap-2 rounded-[var(--nx-radius-button)] bg-white/[0.06] py-2 text-[13px] font-semibold ${BUTTON_CHROME}`}
          style={{ color: "var(--nx-sidebar-text-secondary)" }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ transform: collapsed ? "rotate(180deg)" : undefined }}
          >
            <path d="M14.5 5 8 12l6.5 7" />
          </svg>
          <span className={collapsed ? "sr-only" : undefined}>Contraer</span>
        </button>
      </div>
    </aside>
  );
}
