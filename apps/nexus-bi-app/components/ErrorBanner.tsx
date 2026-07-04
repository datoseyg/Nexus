interface ErrorBannerProps {
  message: string;
  code?: string;
}

// DB_LOCKED / DB_NOT_FOUND llegan con mensajes ya redactados en
// lib/duckdb.ts - acá solo se muestran, sin reinterpretarlos.
export function ErrorBanner({ message, code }: ErrorBannerProps) {
  return (
    <div
      className="rounded-lg border p-4 text-sm"
      style={{
        borderColor: "var(--status-critical)",
        background: "var(--surface-1)",
        color: "var(--text-primary)"
      }}
    >
      <p className="font-semibold" style={{ color: "var(--status-critical)" }}>
        {code === "DB_LOCKED" ? "Base de datos bloqueada" : code === "DB_NOT_FOUND" ? "Base de datos no encontrada" : "Error"}
      </p>
      <p className="mt-1" style={{ color: "var(--text-secondary)" }}>
        {message}
      </p>
    </div>
  );
}
