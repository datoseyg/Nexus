import styles from "./dashboard.module.css";

interface ChartCardProps {
  title: string;
  tall?: boolean;
  available?: boolean;
  unavailableReason?: string;
  children: React.ReactNode;
}

// available=false -> "No disponible" en vez de inventar o dejar un
// gráfico vacío ambiguo (ver docs/DASHBOARD_VISUAL_STYLE.md).
export function ChartCard({ title, tall = false, available = true, unavailableReason, children }: ChartCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>{title}</div>
      <div className={`${styles.chartWrap} ${tall ? styles.chartWrapTall : ""}`}>
        {available ? children : (
          <p className={styles.notAvailable}>{unavailableReason ?? "No disponible en el warehouse actual."}</p>
        )}
      </div>
    </div>
  );
}
