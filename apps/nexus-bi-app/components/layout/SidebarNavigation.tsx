"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BUTTON_CHROME } from "@/components/ui/interactive";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  auditBadge?: boolean;
  feature?: "audit" | "explorer";
}

interface NavSection {
  label: string;
  muted?: boolean;
  items: NavItem[];
}

const ICON_PROPS = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": "true" as const
};

const SECTIONS: NavSection[] = [
  {
    label: "Principal",
    items: [
      {
        href: "/",
        label: "Inicio",
        icon: (
          <svg {...ICON_PROPS}>
            <path d="M3 11.5 12 4l9 7.5" />
            <path d="M5.5 10v9a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1v-9" />
          </svg>
        )
      },
      {
        href: "/search",
        label: "Búsqueda",
        icon: (
          <svg {...ICON_PROPS}>
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m20 20-4.35-4.35" />
          </svg>
        )
      },
    ]
  },
  {
    label: "Exploración de Datos",
    muted: true,
    items: [
      {
        href: "/explorer",
        label: "Explorador",
        feature: "explorer",
        icon: (
          <svg {...ICON_PROPS}>
            <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
            <path d="M4.5 5.5v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-6" />
            <path d="M4.5 11.5v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-6" />
          </svg>
        )
      }
    ]
  },
  {
    label: "Operación",
    items: [
      {
        href: "/dashboard/operacional",
        label: "Dashboard operacional",
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
        label: "FieldBeat",
        icon: (
          <svg {...ICON_PROPS}>
            <path d="M3 12h4l2-7 4 14 2-7h6" />
          </svg>
        )
      },
      {
        href: "/dashboard/after-hours",
        label: "Horas fuera de jornada",
        icon: (
          <svg {...ICON_PROPS}>
            <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
          </svg>
        )
      }
    ]
  },
  {
    label: "Control de calidad",
    items: [
      {
        href: "/audit/manual-review",
        label: "Auditoría de datos",
        auditBadge: true,
        feature: "audit",
        icon: (
          <svg {...ICON_PROPS}>
            <path d="M12 3.5 19 6.5v5c0 4.5-3 7.7-7 8.9-4-1.2-7-4.4-7-8.9v-5Z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
        )
      }
    ]
  }
];

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface SidebarNavigationProps {
  collapsed: boolean;
  pendingReviewCount: number | null;
  onNavigate?: () => void;
  features: { audit: boolean; explorer: boolean };
}

// Lista de navegación compartida por Sidebar (desktop) y MobileSidebar
// (drawer móvil). Dueña única de usePathname()/isActive() para que ambos
// consumidores queden siempre sincronizados con la misma lógica de ruta
// activa - corrige además el patrón frágil de NavBar.tsx (pathname
// .startsWith(href) sin el separador "/", que marcaba activo p.ej.
// "/dashboard/operacional-x" al estar en "/dashboard/operacional").
export function SidebarNavigation({ collapsed, pendingReviewCount, onNavigate, features }: SidebarNavigationProps) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-4 px-2.5 py-3">
      {SECTIONS.map(section => ({
        ...section,
        items: section.items.filter(item => !item.feature || features[item.feature])
      })).filter(section => section.items.length > 0).map(section => (
        <div key={section.label}>
          {!collapsed && (
            <div
              className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wide"
              style={{ color: section.muted ? "var(--nx-sidebar-eyebrow-muted)" : "var(--nx-sidebar-eyebrow)" }}
            >
              {section.label}
            </div>
          )}
          <ul className="flex flex-col gap-0.5">
            {section.items.map(item => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-2.5 rounded-[var(--nx-radius-button)] px-2.5 py-2 text-[13px] font-semibold ${active ? "" : BUTTON_CHROME}`}
                    style={{
                      color: active ? "var(--nx-sidebar-text-primary)" : section.muted ? "var(--nx-sidebar-text-muted)" : "var(--nx-sidebar-text-secondary)",
                      // Sin `background` inline cuando está inactivo (a diferencia de antes,
                      // que fijaba "transparent" acá mismo): un `style.background` con
                      // cualquier valor - incluido "transparent" - tiene más especificidad
                      // que la clase `hover:bg-*` de BUTTON_CHROME y la anula en silencio.
                      // La rama activa no necesita hover, así que conserva su gradiente/rgba
                      // inline intacto.
                      background: active
                        ? section.muted
                          ? "rgba(255,255,255,0.08)"
                          : "linear-gradient(135deg, var(--nx-accent-green), var(--nx-accent-green-light))"
                        : undefined
                    }}
                  >
                    {item.icon}
                    <span className={collapsed ? "sr-only" : undefined}>{item.label}</span>
                    {item.auditBadge && !!pendingReviewCount && (
                      <span
                        className={`rounded-[var(--nx-radius-pill)] px-1.5 text-[11px] font-bold ${collapsed ? "sr-only" : "ml-auto"}`}
                        style={{ background: "#c9564f", color: "#fff" }}
                      >
                        {pendingReviewCount.toLocaleString("es-CL")}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
