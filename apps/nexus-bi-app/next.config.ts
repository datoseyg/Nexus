import type { NextConfig } from "next";

// Leído directo de process.env (no de lib/data-mode.ts) para que
// next.config.ts no dependa de imports TS de la app - esta variable la fija
// el script build:static (ver package.json) antes de invocar `next build`.
const isStaticExport = process.env.NEXT_PUBLIC_DATA_MODE === "static";

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
  },
  // Modo cloud-demo estático (Cloudflare Pages) - ver docs/CLOUD_SMOKE_TEST.md.
  // `output: "export"` es incompatible con los Route Handlers dinámicos de
  // app/api/** (leen request.nextUrl.searchParams), así que build:static
  // los saca temporalmente del árbol antes de invocar `next build` - ver
  // scripts/build-static.mjs.
  ...(isStaticExport ? { output: "export" as const, images: { unoptimized: true } } : {})
};

export default nextConfig;
