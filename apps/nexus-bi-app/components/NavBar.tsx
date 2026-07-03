"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "/dashboard/fieldbeat", label: "Dashboard FieldBeat" },
  { href: "/dashboard/operacional", label: "Dashboard Operacional" },
  { href: "/explorer", label: "Explorador" },
  { href: "/search", label: "Búsqueda" },
  { href: "/audit/manual-review", label: "Auditoría" }
];

// Barra de navegación con identidad E&G Medical Systems (ver
// docs/VISUAL_REDESIGN_EYG.md) — logo verde/teal + link de Auditoría
// destacado con el conteo de pendientes (gold.fieldbeat_report_analysis
// .reports_review_required vía /api/audit/summary).
export function NavBar() {
  const pathname = usePathname();
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/audit/summary")
      .then(res => res.json())
      .then(body => setPendingCount(body?.reportsReviewRequired ?? null))
      .catch(() => setPendingCount(null));
  }, []);

  return (
    <header className="border-b" style={{ borderColor: "var(--eyg-border)", background: "var(--eyg-card)" }}>
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold" style={{ color: "var(--text-primary)" }}>
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-white"
            style={{ background: "linear-gradient(135deg, var(--eyg-green-dark), var(--eyg-teal))" }}
          >
            EyG
          </span>
          Nexus BI
        </Link>

        <nav className="flex flex-wrap gap-1 text-sm">
          {LINKS.map(link => {
            const active = pathname?.startsWith(link.href);
            const isAudit = link.href === "/audit/manual-review";
            return (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
                style={{
                  color: active ? "#fff" : isAudit && pendingCount ? "var(--eyg-danger)" : "var(--text-secondary)",
                  background: active ? "var(--eyg-green-dark)" : "transparent",
                  fontWeight: active || (isAudit && pendingCount) ? 600 : 400
                }}
              >
                {link.label}
                {isAudit && !!pendingCount && (
                  <span
                    className="rounded-full px-1.5 text-xs font-bold"
                    style={{
                      background: active ? "rgba(255,255,255,0.25)" : "#fbeae9",
                      color: active ? "#fff" : "var(--eyg-danger)"
                    }}
                  >
                    {pendingCount.toLocaleString("es-CL")}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
          Fase 1 MVP — solo lectura
        </span>
      </div>
    </header>
  );
}
