import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @duckdb/node-api usa un binding nativo - debe quedar fuera del bundle
  // de servidor de Next.js (empaquetarlo rompe el .node binario). pdfkit
  // (Phase 6) tiene el mismo problema mas alla de un binario nativo: carga
  // sus fuentes estandar (Helvetica.afm, etc.) en runtime via una ruta
  // relativa a su propio __dirname dentro de node_modules/pdfkit/js/data -
  // Turbopack reescribe ese __dirname al empaquetar la route de PDF,
  // rompiendo la lectura ("ENOENT node_modules/pdfkit/js/data/Helvetica.afm",
  // encontrado en validacion real de navegador: node --experimental-strip-types
  // sobre el modulo aislado SI funcionaba, pero /api/.../pdf via next dev
  // fallaba - la diferencia era exactamente el bundling). serverExternalPackages
  // saca el paquete del bundle y lo deja como require() real desde
  // node_modules, con su __dirname intacto.
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings", "pdfkit"],
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
