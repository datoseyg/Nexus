interface ChartCardProps {
  title: string;
  tall?: boolean;
  available?: boolean;
  unavailableReason?: string;
  children: React.ReactNode;
}

// Generaliza components/dashboard/ChartCard.tsx (mismo contrato) con
// Tailwind + tokens --nx-* en vez de dashboard.module.css, para poder
// usarse fuera del Dashboard Operacional. El original no se toca ni se
// borra - lo sigue usando OperationalDashboardTab.tsx. Este componente
// todavía no está conectado a ninguna pantalla.
//
// available=false -> mensaje explícito en vez de un gráfico vacío
// ambiguo o inventado.
export function ChartCard({ title, tall = false, available = true, unavailableReason, children }: ChartCardProps) {
  return (
    <div
      className="flex flex-col rounded-[var(--nx-radius-card)] p-4"
      style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}
    >
      <div
        className="mb-2.5 text-xs font-bold uppercase tracking-wide"
        style={{ color: "var(--nx-text-muted)" }}
      >
        {title}
      </div>
      <div
        className={`relative ${tall ? "min-h-[240px] h-[clamp(240px,32vw,300px)]" : "min-h-[220px] h-[clamp(220px,28vw,260px)]"}`}
      >
        {available ? (
          children
        ) : (
          <p className="p-6 text-center text-xs italic" style={{ color: "var(--nx-text-muted)" }}>
            {unavailableReason ?? "No disponible."}
          </p>
        )}
      </div>
    </div>
  );
}
