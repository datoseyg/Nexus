import { useId } from "react";
import { formatNumberEsCl } from "@/lib/dashboard-formatters";

export interface ChartAccessibleData {
  /** Categorías del gráfico, en el mismo orden que `values`. */
  labels: string[];
  /** Valores reales del mismo dataset que dibuja el gráfico visual. */
  values: number[];
  /** Sustantivo plural de la categoría, ej. "estados", "clientes", "bodegas", "meses". */
  unitLabel: string;
  /** Texto que sigue al valor formateado, ej. "reportes", "%". Opcional. */
  valueSuffix?: string;
}

export type ChartCardSize = "line" | "bar" | "matrix" | "donut";

// Alturas orientativas por tipo (corrección visual ETAPA 4): el mínimo del
// clamp() ya cae dentro del rango móvil pedido (240-300px según tipo) sin
// necesidad de un breakpoint aparte, y el máximo cubre el rango de
// escritorio 1440-1600px. "donut" no fuerza altura acá - ver DonutPanel en
// OperationalDashboardTab.tsx, que gestiona su propia caja cuadrada.
const SIZE_HEIGHT_CLASS: Record<ChartCardSize, string> = {
  line: "h-[clamp(280px,34vw,380px)]",
  bar: "h-[clamp(260px,30vw,340px)]",
  matrix: "h-[clamp(280px,36vw,420px)]",
  donut: ""
};

interface ChartCardProps {
  title: string;
  subtitle?: string;
  /** Reemplaza al antiguo `tall` - controla la altura real del área de gráfico. */
  size?: ChartCardSize;
  available?: boolean;
  unavailableReason?: string;
  /**
   * Datos reales para la alternativa textual accesible (título + resumen +
   * tabla sr-only). Un aria-label suelto no es una alternativa equivalente
   * (ver ETAPA 4.0 §16) - por eso este prop pide el dataset completo, no
   * solo una etiqueta. Si se omite, el gráfico no queda aria-hidden (no hay
   * alternativa equivalente que lo reemplace).
   */
  accessibleData?: ChartAccessibleData;
  children: React.ReactNode;
}

function buildSummary(data: ChartAccessibleData): string {
  const { labels, values, unitLabel, valueSuffix } = data;
  const suffix = valueSuffix ? ` ${valueSuffix}` : "";
  const total = values.reduce((sum, v) => sum + v, 0);

  if (labels.length === 0 || total === 0) {
    return `Sin datos en ${unitLabel} para este filtro.`;
  }

  let maxIndex = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > values[maxIndex]) maxIndex = i;
  }

  return (
    `${labels.length} ${unitLabel}. ${labels[maxIndex]} concentra el mayor valor ` +
    `(${formatNumberEsCl(values[maxIndex])}${suffix} de ${formatNumberEsCl(total)}${suffix} representados).`
  );
}

// available=false -> "No disponible" en vez de inventar o dejar un
// gráfico vacío ambiguo. Migrado a tokens --nx-* (ver standalone de
// Dashboard Operacional) y con alternativa textual accesible: cada
// gráfico visual queda aria-hidden solo cuando ya existe, en el mismo
// componente, un resumen calculado + una tabla oculta (sr-only) con las
// mismas categorías/valores - ver ETAPA 4.0 §16 y encargo de ETAPA 4 §10.
//
// Corrección visual (2ª pasada): el área de gráfico usaba una altura fija
// pequeña sin `maintainAspectRatio:false` en los charts consumidores, lo
// que dejaba el canvas encogido dentro de una tarjeta grande. Acá solo se
// entrega el alto real por tipo (`size`) - `maintainAspectRatio:false` se
// configura en cada <Bar>/<Line>/<Doughnut>/<Pie> (OperationalDashboardTab
// / UptimeDowntimeTab) para que el canvas efectivamente llene esta caja.
export function ChartCard({
  title,
  subtitle,
  size = "bar",
  available = true,
  unavailableReason,
  accessibleData,
  children
}: ChartCardProps) {
  const headingId = useId();
  const hasAccessibleAlternative = available && !!accessibleData;

  return (
    <div
      className="flex h-fit min-w-0 flex-col rounded-[var(--nx-radius-card)] p-5"
      style={{ background: "var(--nx-card-bg)", boxShadow: "var(--nx-shadow-card)" }}
    >
      <h3 id={headingId} className="text-[16px] font-bold" style={{ color: "var(--nx-text-primary)" }}>
        {title}
      </h3>
      {subtitle && (
        <p className="mb-3 mt-0.5 text-[13px]" style={{ color: "var(--nx-text-secondary)" }}>
          {subtitle}
        </p>
      )}

      <div
        className={`relative w-full min-w-0 ${SIZE_HEIGHT_CLASS[size]}`}
        {...(hasAccessibleAlternative ? { "aria-hidden": true as const } : { role: "img", "aria-labelledby": headingId })}
      >
        {available ? (
          children
        ) : (
          <p className="p-6 text-center text-[13px] italic" style={{ color: "var(--nx-text-secondary)" }}>
            {unavailableReason ?? "No disponible en el warehouse actual."}
          </p>
        )}
      </div>

      {hasAccessibleAlternative && (
        <div className="sr-only">
          <p>{buildSummary(accessibleData)}</p>
          <table>
            <caption>{`${title} -datos completos`}</caption>
            <thead>
              <tr>
                <th scope="col">Categoría</th>
                <th scope="col">Valor</th>
              </tr>
            </thead>
            <tbody>
              {accessibleData.labels.map((label, index) => (
                <tr key={`${label}-${index}`}>
                  <td>{label}</td>
                  <td>
                    {formatNumberEsCl(accessibleData.values[index])}
                    {accessibleData.valueSuffix ? ` ${accessibleData.valueSuffix}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
