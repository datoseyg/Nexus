import type { NextConfig } from "next";

// Leído directo de process.env (no de lib/data-mode.ts) para que
// next.config.ts no dependa de imports TS de la app - esta variable la fijan
// los scripts build:static / build:d1 (ver package.json) antes de invocar
// `next build`. Tanto "static" (JSON pre-generado) como "d1" (Cloudflare D1
// vía Pages Functions en functions/) se sirven como sitio estático en
// Cloudflare Pages - ninguno de los dos corre un servidor Node, así que
// ambos necesitan `output: "export"`.
const dataMode = process.env.NEXT_PUBLIC_DATA_MODE;
const isCloudflareExport = dataMode === "static" || dataMode === "d1";

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
  // Modo cloud-demo estático / D1 (Cloudflare Pages) - ver
  // docs/CLOUD_SMOKE_TEST.md y docs/CLOUDFLARE_D1_MIGRATION.md.
  // `output: "export"` es incompatible con los Route Handlers dinámicos de
  // app/api/** (leen request.nextUrl.searchParams), así que build:static /
  // build:d1 los sacan temporalmente del árbol antes de invocar
  // `next build` - ver scripts/build-static.mjs.
  ...(isCloudflareExport ? { output: "export" as const, images: { unoptimized: true } } : {})
};

export default nextConfig;
