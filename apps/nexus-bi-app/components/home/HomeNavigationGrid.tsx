import Link from "next/link";
import { CARD_INTERACTIVE } from "@/components/ui/interactive";

type NavAccent = "green" | "indigo" | "purple" | "amber";

interface NavItem {
  href: string;
  title: string;
  description: string;
  accent: NavAccent;
  icon: React.ReactNode;
  feature?: "audit";
}

const ICON_PROPS = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": "true" as const
};

const ACCENT_COLOR: Record<NavAccent, string> = {
  green: "var(--nx-accent-green)",
  indigo: "var(--nx-accent-indigo)",
  purple: "var(--nx-accent-purple)",
  amber: "var(--nx-warning-border)"
};

const ITEMS: readonly NavItem[] = [
  {
    href: "/dashboard/operacional",
    title: "Dashboard Operacional",
    description: "Cruza reportes, tickets y repuestos para analizar la operación.",
    accent: "green",
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.2" />
        <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.2" />
        <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.2" />
        <rect x="13" y="13" width="7.5" height="7.5" rx="1.2" />
      </svg>
    )
  },
  {
    href: "/dashboard/fieldbeat",
    title: "FieldBeat",
    description: "Consulta toda la actividad registrada en terreno.",
    accent: "indigo",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M3 12h4l2-7 4 14 2-7h6" />
      </svg>
    )
  },
  {
    href: "/dashboard/after-hours",
    title: "Trabajo fuera de horario",
    description: "Revisa actividad detectada fuera del horario configurado.",
    accent: "purple",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
      </svg>
    )
  },
  {
    href: "/audit/manual-review",
    title: "Auditoría",
    description: "Identifica información incompleta o que requiere revisión.",
    accent: "amber",
    feature: "audit",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M12 3.5 19 6.5v5c0 4.5-3 7.7-7 8.9-4-1.2-7-4.4-7-8.9v-5Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    )
  }
];

// Server Component, sin dependencia de datos - los 4 accesos principales
// siguen navegables aunque los 4 fetch de HomeDashboard fallen. Cada
// tarjeta completa es el <Link>, nunca un <div onClick>.
export function HomeNavigationGrid({ showAudit }: { showAudit: boolean }) {
  const visibleItems = ITEMS.filter(item => showAudit || item.feature !== "audit");

  return (
    <section>
      <h2
        className="mb-2 text-xs font-bold uppercase tracking-wide"
        style={{ color: "var(--nx-text-muted)" }}
      >
        Accesos principales
      </h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {visibleItems.map(item => (
          <li key={item.href}>
            <Link
              href={item.href}
              className={`flex h-full min-w-0 flex-col gap-1.5 rounded-[var(--nx-radius-card)] border-t-[3px] p-4 ${CARD_INTERACTIVE}`}
              style={{
                borderTopColor: ACCENT_COLOR[item.accent],
                background: "var(--nx-card-bg)",
                boxShadow: "var(--nx-shadow-card)"
              }}
            >
              <span style={{ color: ACCENT_COLOR[item.accent] }}>{item.icon}</span>
              <span className="text-[15px] font-bold" style={{ color: "var(--nx-text-primary)" }}>
                {item.title}
              </span>
              <span className="break-words text-[13px]" style={{ color: "var(--nx-text-secondary)" }}>
                {item.description}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
