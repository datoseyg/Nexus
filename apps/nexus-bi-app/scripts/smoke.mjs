const BASE_URL = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 5000);

const CHECKS = [
  { path: "/login", kind: "page", status: 200, marker: "Entra a NEXUS" },
  { path: "/", kind: "redirect", status: 307, location: "/login" },
  { path: "/dashboard/fieldbeat", kind: "redirect", status: 307, location: "/login" },
  // Phase 3 - /api/dashboard/fieldbeat (el GOLD fijo de 5 agregados) y
  // /api/dashboard/fieldbeat/activity se eliminaron (§11: sin consumidores
  // tras el rediseño de 4 pestañas) - /overview es el endpoint que
  // realmente alimenta la Visión ejecutiva ahora.
  { path: "/api/dashboard/fieldbeat/overview", kind: "api", status: 401, code: "UNAUTHORIZED" },
  { path: "/api/search", kind: "api", status: 401, code: "UNAUTHORIZED" }
];

const ERROR_MARKERS = [
  "application error",
  "unhandled runtime error",
  "internal server error",
  "this page could not be found"
];

function stripScriptsAndStyles(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
}

async function checkRoute(check) {
  const url = new URL(check.path, BASE_URL);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = performance.now();

  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
    const durationMs = Math.round(performance.now() - startedAt);

    if (response.status !== check.status) {
      return { ...check, durationMs, result: "FAIL", reason: `status ${response.status}; esperado ${check.status}` };
    }

    if (check.kind === "redirect") {
      const location = response.headers.get("location");
      if (!location || new URL(location, url).origin !== url.origin || new URL(location, url).pathname !== check.location) {
        return { ...check, durationMs, result: "FAIL", reason: `redirect inseguro o inesperado: ${location}` };
      }
    }

    if (check.kind === "api") {
      const contentType = response.headers.get("content-type") ?? "";
      const body = await response.json().catch(() => null);
      if (!contentType.includes("application/json") || body?.code !== check.code) {
        return { ...check, durationMs, result: "FAIL", reason: "la API no devolvió el JSON de autorización esperado" };
      }
    }

    if (check.kind === "page") {
      const html = await response.text();
      const cleaned = stripScriptsAndStyles(html).toLowerCase();
      const errorMarker = ERROR_MARKERS.find(marker => cleaned.includes(marker));
      if (errorMarker || !html.includes(check.marker)) {
        return { ...check, durationMs, result: "FAIL", reason: errorMarker ?? `falta marcador ${check.marker}` };
      }
    }

    return { ...check, durationMs, result: "OK", reason: null };
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    const reason = error?.name === "AbortError" ? `timeout tras ${TIMEOUT_MS}ms` : `error de red: ${error?.message}`;
    return { ...check, durationMs, result: "FAIL", reason };
  } finally {
    clearTimeout(timer);
  }
}

console.log(`Smoke AUTH-P0 sin sesión contra ${BASE_URL}\n`);
const results = [];
for (const check of CHECKS) results.push(await checkRoute(check));

for (const result of results) {
  console.log(`[${result.result}] ${result.path.padEnd(30)} status=${result.status} ${String(result.durationMs).padStart(5)}ms${result.reason ? ` -> ${result.reason}` : ""}`);
}

const failures = results.filter(result => result.result === "FAIL");
if (failures.length > 0) {
  console.error(`\nSmoke AUTH-P0 falló: ${failures.length}/${results.length}.`);
  process.exit(1);
}

console.log(`\nSmoke AUTH-P0 OK: ${results.length}/${results.length}.`);
