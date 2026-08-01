"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { MobileTopBar } from "@/components/layout/MobileTopBar";
import { MobileSidebar } from "@/components/layout/MobileSidebar";

const COLLAPSE_STORAGE_KEY = "nx-sidebar-collapsed";

function readStoredCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

interface AppShellProps {
  children: React.ReactNode;
  userLabel: string | null;
  features: { audit: boolean; explorer: boolean };
  capabilities: string[];
}

// Orquestador raíz del shell de navegación (montado una sola vez en
// app/layout.tsx, ver ese archivo). Dueño único de: estado de colapso de
// la sidebar desktop (persistido, ver readStoredCollapsed/hydrated más
// abajo), apertura del drawer móvil (efímera, nunca persistida), y el
// fetch del badge de pendientes de Auditoría (antes en NavBar.tsx).
//
// NavBar.tsx (HEAD, git show) se montaba dentro de cada page.tsx - el
// layout raíz anterior no lo renderizaba - así que se remontaba en cada
// navegación entre rutas distintas y su useEffect(fetch, []) se
// reejecutaba. Este shell ya no se remonta entre rutas (vive en
// app/layout.tsx), así que para preservar ese refresco por navegación se
// vuelve a pedir /api/audit/summary cuando cambia `pathname`, en vez de
// una sola vez al montar. AbortController cancela la petición en vuelo si
// el usuario navega de nuevo antes de que responda, para que una
// respuesta tardía de una ruta anterior no pise el conteo de la ruta
// actual.
export function AppShell({ children, userLabel, features, capabilities }: AppShellProps) {
  const pathname = usePathname();
  const publicRoute = pathname === "/login";
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pendingReviewCount, setPendingReviewCount] = useState<number | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileSidebarId = useId();

  useEffect(() => {
    setCollapsed(readStoredCollapsed());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || publicRoute) return;
    try {
      window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(collapsed));
    } catch {
      /* best-effort */
    }
  }, [collapsed, hydrated, publicRoute]);

  useEffect(() => {
    if (publicRoute || !userLabel) return;

    const controller = new AbortController();

    fetch("/api/audit/summary", { signal: controller.signal })
      .then(res => res.json())
      .then(body => setPendingReviewCount(body?.reportsReviewRequired ?? null))
      .catch(err => {
        if (err?.name === "AbortError") return;
        setPendingReviewCount(null);
      });

    return () => controller.abort();
  }, [pathname, publicRoute, userLabel]);

  if (publicRoute || !userLabel) return children;

  return (
    <>
      <div className="flex min-h-screen" inert={mobileOpen}>
        <Sidebar
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed(value => !value)}
          pendingReviewCount={pendingReviewCount}
          userLabel={userLabel}
          features={features}
          capabilities={capabilities}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileTopBar
            mobileOpen={mobileOpen}
            onOpenMenu={() => setMobileOpen(true)}
            menuButtonRef={menuButtonRef}
            mobileSidebarId={mobileSidebarId}
          />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
      <MobileSidebar
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        pendingReviewCount={pendingReviewCount}
        returnFocusRef={menuButtonRef}
        mobileSidebarId={mobileSidebarId}
        userLabel={userLabel}
        features={features}
      />
    </>
  );
}
