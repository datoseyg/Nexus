"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { logoutAction } from "@/app/login/actions";
import {
  INITIAL_LOGOUT_STATE,
  type LogoutActionState,
} from "@/app/login/action-state";
import { BUTTON_CHROME } from "@/components/ui/interactive";

function LogoutButton({ compact }: { compact: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={pending ? "Cerrando sesión" : "Cerrar sesión"}
      className={`flex w-full items-center gap-2 rounded-[var(--nx-radius-button)] bg-white/[0.06] px-2.5 py-2 text-[12px] font-semibold ${BUTTON_CHROME}`}
      style={{ color: "var(--nx-sidebar-text-secondary)" }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10" />
        <path d="m15 8 4 4-4 4M9 12h10" />
      </svg>
      <span className={compact ? "sr-only" : undefined}>{pending ? "Cerrando…" : "Cerrar sesión"}</span>
    </button>
  );
}

export function UserSessionControls({ label, compact = false }: { label: string; compact?: boolean }) {
  const [state, formAction] = useActionState(logoutAction, INITIAL_LOGOUT_STATE);

  return (
    <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
      <div className={`flex items-center gap-2 px-2.5 ${compact ? "justify-center" : ""}`}>
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold"
          style={{ color: "#fff", background: "var(--nx-accent-indigo)" }}
          aria-hidden="true"
        >
          {label.slice(0, 1)}
        </span>
        <span className={compact ? "sr-only" : "text-[12px] font-bold"} style={{ color: "var(--nx-sidebar-text-primary)" }}>
          {label}
        </span>
      </div>
      <form action={formAction}>
        <LogoutButton compact={compact} />
      </form>
      {state.error ? (
        <p className={compact ? "sr-only" : "px-2.5 text-[11px]"} style={{ color: "#fca5a5" }} role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
