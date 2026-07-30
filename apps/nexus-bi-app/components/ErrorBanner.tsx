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
        borderColor: "var(--nx-danger-fg, #c0392b)",
        background: "var(--nx-card-bg)",
        color: "var(--nx-text-primary)"
      }}
    >
      <p className="font-semibold" style={{ color: "var(--nx-danger-fg, #c0392b)" }}>
        {code === "DB_LOCKED" ? "Base de datos bloqueada" : code === "DB_NOT_FOUND" ? "Base de datos no encontrada" : "Error"}
      </p>
      <p className="mt-1" style={{ color: "var(--nx-text-secondary)" }}>
        {message}
      </p>
    </div>
  );
}
