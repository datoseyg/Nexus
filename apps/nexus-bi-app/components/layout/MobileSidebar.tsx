"use client";

import { useEffect, useId, useRef } from "react";
import { SidebarBrand } from "@/components/layout/SidebarBrand";
import { SidebarNavigation } from "@/components/layout/SidebarNavigation";
import { UserSessionControls } from "@/components/layout/UserSessionControls";

interface MobileSidebarProps {
  open: boolean;
  onClose: () => void;
  pendingReviewCount: number | null;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  mobileSidebarId: string;
  userLabel: string;
  features: { audit: boolean; explorer: boolean };
}

// Drawer de navegación móvil, accesible. Replica el patrón ya probado en
// components/ui/DetailDrawer.tsx (role=dialog/aria-modal/aria-labelledby/
// Escape/focus trap/scroll lock/restauración de foco) sin importarlo ni
// modificarlo - lado, ancho, z-index y semántica de props son distintos
// (ver justificación completa en el plan aprobado de Etapa 2). A
// diferencia de DetailDrawer, la restauración de foco usa una ref
// explícita (returnFocusRef, reenviada por AppShell desde el botón
// hamburguesa de MobileTopBar) en vez de document.activeElement.
export function MobileSidebar({ open, onClose, pendingReviewCount, returnFocusRef, mobileSidebarId, userLabel, features }: MobileSidebarProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    panelRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function getFocusable(): HTMLElement[] {
      const panel = panelRef.current;
      if (!panel) return [];
      return Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, [open, onClose, returnFocusRef]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 md:hidden" style={{ zIndex: "var(--nx-z-mobile-drawer)" }}>
      <div className="absolute inset-0" style={{ background: "var(--nx-overlay-bg)" }} onClick={onClose} aria-hidden="true" />
      <div
        id={mobileSidebarId}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="nx-shell-chrome absolute left-0 top-0 bottom-0 flex w-[240px] flex-col overflow-y-auto"
        style={{ background: "var(--nx-sidebar-bg)", boxShadow: "var(--nx-shadow-drawer-left)" }}
      >
        <div className="flex items-center justify-between px-1">
          <div id={titleId} className="sr-only">
            Menú de navegación
          </div>
          <SidebarBrand collapsed={false} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar menú"
            className="mr-2.5 flex h-8 w-8 items-center justify-center rounded-[var(--nx-radius-button)]"
            style={{ color: "var(--nx-sidebar-text-secondary)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="flex-1">
          <SidebarNavigation collapsed={false} pendingReviewCount={pendingReviewCount} onNavigate={onClose} features={features} />
        </div>
        <div className="px-2.5 pb-3">
          <UserSessionControls label={userLabel} />
        </div>
      </div>
    </div>
  );
}
