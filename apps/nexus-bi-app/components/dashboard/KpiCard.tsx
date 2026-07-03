import styles from "./dashboard.module.css";

interface KpiCardProps {
  label: string;
  value: string;
  variant?: "default" | "action" | "client";
  onClick?: () => void;
}

export function KpiCard({ label, value, variant = "default", onClick }: KpiCardProps) {
  if (variant === "action") {
    return (
      <button type="button" onClick={onClick} className={`${styles.kpiCard} ${styles.kpiCardAction}`}>
        <span>{value}</span>
      </button>
    );
  }

  return (
    <div className={`${styles.kpiCard} ${variant === "client" ? styles.kpiCardClient : ""}`}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={styles.kpiValue}>{value}</div>
    </div>
  );
}
