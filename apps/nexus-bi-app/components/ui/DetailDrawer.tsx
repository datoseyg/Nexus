"use client";

import { useEffect, useId, useRef } from "react";

interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footerNote?: string;
  /** Ancho del panel (clases Tailwind responsivas) - opcional, default
   * preserva el ancho original (360-380px) para los consumidores existentes
   * (AfterHours, Search). Un detalle más rico (ej. FieldBeat, Phase 5)
   * puede pedir un panel más ancho sin afectar a nadie más. */
  panelWidthClassName?: string;
}

const DEFAULT_PANEL_WIDTH_CLASS = "w-full sm:w-[360px] md:w-[380px]";

// Drawer lateral genérico y accesible, replicando el patrón repetido en los
// 5 drawers de docs/design-revolution/*.dc.html (overlay + panel fijo
// 360-380px + header con cierre + contenido + nota inferior opcional).
// Todavía sin conectar a ninguna pantalla.
//
// Accesibilidad implementada: role="dialog" + aria-modal + aria-labelledby,
// cierre con Escape, botón de cierre con aria-label, bloqueo de scroll del
// body mientras está abierto, restauración del foco al elemento que lo
// tenía antes de abrir, overlay clickeable para cerrar, y un focus trap
// básico (Tab/Shift+Tab cicla dentro del panel).
//
// Limitaciones conocidas de este focus trap básico, documentadas antes de
// que cualquier pantalla lo use:
// - no contempla drawers anidados (abrir un DetailDrawer desde otro);
// - no fue probado contra un lector de pantalla real, solo contra la
//   semántica ARIA esperada;
// - si `children` no contiene ningún elemento enfocable, el foco queda en
//   el botón de cierre (comportamiento correcto, pero sin más alternativas
//   dentro del panel).
export function DetailDrawer({ open, onClose, title, children, footerNote, panelWidthClassName }: DetailDrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

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
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0"
        style={{ background: "var(--nx-overlay-bg)", zIndex: "var(--nx-z-overlay)" as unknown as number }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`fixed top-0 right-0 bottom-0 overflow-y-auto p-[22px] ${panelWidthClassName ?? DEFAULT_PANEL_WIDTH_CLASS}`}
        style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-drawer)", zIndex: "var(--nx-z-drawer)" as unknown as number }}
      >
        <div className="mb-3.5 flex items-start justify-between">
          <div id={titleId} className="text-base font-extrabold" style={{ color: "var(--nx-text-primary)" }}>
            {title}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar detalle"
            className="-m-2.5 flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full transition-colors duration-150 ease-out hover:bg-[rgba(74,85,212,0.08)] active:bg-[rgba(74,85,212,0.16)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nx-focus-ring-color)] focus-visible:ring-offset-2 motion-reduce:transition-none"
            style={{ color: "var(--nx-text-secondary)" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {children}

        {footerNote && (
          <div
            className="mt-4 border-t pt-3 text-xs"
            style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-muted)" }}
          >
            {footerNote}
          </div>
        )}
      </div>
    </>
  );
}
