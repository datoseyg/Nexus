import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";

interface LifecycleConfidenceBadgeProps {
  score: number;
  label: string;
  factors?: string | null;
  size?: "sm" | "md";
}

// Wrapper delgado sobre ConfidenceBadge.tsx (reusa los mismos tiers/colores
// de todo Nexus BI) - existe como componente propio solo para que el resto
// de equipment-lifecycle/* lo importe desde su propia carpeta, sin acoplar
// esta vista al nombre interno de components/ui.
export function LifecycleConfidenceBadge({ score, label, factors, size = "md" }: LifecycleConfidenceBadgeProps) {
  return <ConfidenceBadge score={score} label={label} factors={factors} size={size} />;
}
