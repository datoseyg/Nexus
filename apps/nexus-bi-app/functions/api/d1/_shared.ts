// Helper compartido de las Pages Functions D1 (ver
// docs/CLOUDFLARE_D1_MIGRATION.md). El prefijo "_" excluye este archivo del
// ruteo de Cloudflare Pages Functions (no es un endpoint, solo un módulo).
//
// functions/ corre en el runtime de Cloudflare Workers, NO en el server de
// Next.js - por eso vive fuera de app/ y tiene su propio tsconfig.json
// (ver ../../tsconfig.json, que lo excluye explícitamente).

export interface Env {
  DB: D1Database;
}

export function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init?.headers
    }
  });
}

export function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, { status });
}
