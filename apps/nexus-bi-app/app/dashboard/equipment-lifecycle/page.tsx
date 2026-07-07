import { AppShell } from "@/components/ui/AppShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { EquipmentLifecycleShell } from "@/components/equipment-lifecycle/EquipmentLifecycleShell";

export const metadata = {
  title: "Vida Útil de Repuestos por Máquina - Nexus BI"
};

// Vista independiente (no una sección de /dashboard/operacional) - ver
// docs/EQUIPMENT_PART_LIFECYCLE_ANALYSIS.md. Mismo esqueleto que las otras
// vistas (AppShell wide + un Shell client-side propio).
export default function EquipmentLifecyclePage() {
  return (
    <AppShell wide>
      <div className="space-y-4">
        <PageHeader
          title="Vida Útil de Repuestos por Máquina"
          description="Estimaciones preliminares basadas en historial FieldBeat, repuestos Dolibarr y eventos observados."
        />

        <SectionCard>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Las estimaciones muestran vida útil observada/estimada y confiabilidad metodológica. <strong>No reemplazan
            especificaciones del fabricante</strong> ni garantías contractuales - son evidencia operacional observada
            en los datos de E&amp;G, nunca una promesa de precisión. Ver <code>docs/EQUIPMENT_PART_LIFECYCLE_ANALYSIS.md</code>{" "}
            y <code>docs/CALCULATION_CONFIDENCE_MODEL.md</code>.
          </p>
        </SectionCard>

        <EquipmentLifecycleShell />
      </div>
    </AppShell>
  );
}
