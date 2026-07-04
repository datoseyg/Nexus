import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @duckdb/node-api usa un binding nativo - debe quedar fuera del bundle
  // de servidor de Next.js (empaquetarlo rompe el .node binario).
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings"],
  // Evita que Next.js infiera la raíz del workspace subiendo hasta
  // eyg-nexus-local/ (que también tiene package-lock.json) - esta app es
  // su propio proyecto independiente, no un paquete de un monorepo.
  // process.cwd() en next.config.ts siempre resuelve a esta carpeta
  // (donde se corre `next dev`/`next build`).
  turbopack: {
    root: process.cwd()
  }
};

export default nextConfig;
