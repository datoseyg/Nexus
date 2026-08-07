import { PageHeader } from "@/components/ui/PageHeader";

interface AfterHoursHeaderProps {
  rangeLabel: string;
}

// Encabezado de /dashboard/after-hours (ETAPA 6.6D §5) - reusa PageHeader
// (soporta `actions`) dentro de la franja blanca del shell, mismo patrón
// que components/dashboard/DashboardShell.tsx. Sin botón "Descargar
// informe": no existe una acción de exportación real y verificada para
// esta pantalla (docs/design-revolution/Claude-Designs/
// Nexus - Handoff de Implementacion.dc.html §5 lo documenta
// explícitamente) - un botón decorativo violaría el principio de
// trazabilidad del propio sistema de diseño (09-design-principles.md #1).
export function AfterHoursHeader({ rangeLabel }: AfterHoursHeaderProps) {
  return (
    <PageHeader
      title="Trabajo fuera de horario"
      description="Analiza tareas registradas dentro y fuera de la cobertura horaria, utilizando contratos vigentes o el horario global cuando corresponde."
      actions={
        <>
          <span
            className="rounded-[var(--nx-radius-chip)] px-3 py-1.5 text-[13px] font-semibold"
            style={{ background: "var(--nx-page-bg)", color: "var(--nx-text-primary)" }}
          >
            {rangeLabel}
          </span>
          <span
            className="rounded-[var(--nx-radius-chip)] border px-3 py-1.5 text-[13px]"
            style={{ borderColor: "var(--nx-border)", background: "var(--nx-card-bg)", color: "var(--nx-text-secondary)" }}
          >
            Actualizar datos antes de analizar.
          </span>
        </>
      }
    />
  );
}
