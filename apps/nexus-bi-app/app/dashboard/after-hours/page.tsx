import { PageContainer } from "@/components/ui/PageContainer";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { AfterHoursShell } from "@/components/after-hours/AfterHoursShell";

export const metadata = {
  title: "Trabajo Fuera de Horario - Nexus BI"
};

// Vista independiente (no una sección de /dashboard/operacional) - ver
// docs/AFTER_HOURS_METRICS.md. Mismo esqueleto que las otras páginas
// (PageContainer wide + un Shell client-side propio).
export default function AfterHoursPage() {
  return (
    <PageContainer wide>
      <div className="space-y-4">
        <PageHeader
          title="Trabajo Fuera de Horario"
          description="Análisis de horas registradas fuera de la ventana hábil configurada. Cálculo preliminar basado en datos FieldBeat y reglas de calendario laboral."
        />

        <SectionCard>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Este módulo calcula estimaciones operacionales. Cada indicador incluye un porcentaje de confiabilidad según
            la calidad y completitud de los datos usados. El score de confiabilidad es <strong>metodológico</strong>,
            no una probabilidad estadística - nunca representa una garantía de certeza absoluta. Ver{" "}
            <code>docs/CALCULATION_CONFIDENCE_MODEL.md</code> y <code>docs/AFTER_HOURS_METRICS.md</code>.
          </p>
        </SectionCard>

        <AfterHoursShell />
      </div>
    </PageContainer>
  );
}
