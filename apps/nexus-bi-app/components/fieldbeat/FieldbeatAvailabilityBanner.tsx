// Reproduce el banner naranja "Diseño deseado" del mockup - texto honesto,
// nunca oculto dentro de la sección consolidada de limitaciones al final.
export function FieldbeatAvailabilityBanner() {
  return (
    <div
      role="status"
      className="rounded-xl border-[1.5px] px-4 py-3 text-[13px]"
      style={{ background: "var(--nx-warning-bg)", borderColor: "var(--nx-warning-border)", color: "var(--nx-warning-fg)" }}
    >
      Diseño deseado: el origen de datos actual todavía no admite filtros por período, cliente, máquina, tipo de tarea, origen, ticket y repuesto.
    </div>
  );
}
