// Smoke test minimo de ETAPA 0 (ver plan de rediseno, docs/design-context/).
//
// Que confirma: que cada ruta de producto responde HTTP 200 y contiene un
// marcador de texto propio ya existente hoy en esa pagina (no un texto del
// rediseno futuro), y que el HTML recibido no es en realidad una pagina de
// error de Next.js/React disfrazada de 200.
//
// Que NO confirma: no es una prueba de regresion visual. No compara pixeles,
// layout ni estilos. Solo valida renderizado HTTP y ausencia de errores
// funcionales basicos.
//
// Configuracion: si BASE_URL esta definida, tiene prioridad absoluta sobre
// PORT. Si no, se usa http://localhost:${PORT ?? 3000}.
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 5000);

// Marcador textual estable, unico y ya existente hoy en cada pagina, tomado
// directamente del codigo fuente actual (PageHeader/title visibles o
// metadata.title). /dashboard/fieldbeat y /explorer son componentes
// "use client" que hacen fetch de datos en el navegador (useEffect) y
// muestran su titulo real recien despues de esa carga - una peticion HTTP
// pura (sin ejecutar JavaScript, como hace este script) solo ve el HTML
// inicial servido por el servidor, que en esos 2 casos es el estado de
// carga ("Cargando dashboard...", "Cargando tablas..."), no el titulo
// final. Se usa ese marcador de carga para esas 2 rutas por ser el que
// realmente esta presente en la respuesta HTTP cruda.
const ROUTES = [
  { path: "/", marker: "Nexus BI (Fase 1 MVP)" },
  { path: "/dashboard/fieldbeat", marker: "Cargando dashboard…" },
  { path: "/dashboard/operacional", marker: "Dashboard Operacional EyG - Nexus BI" },
  { path: "/dashboard/after-hours", marker: "Trabajo Fuera de Horario" },
  { path: "/audit/manual-review", marker: "Auditoría y Validación Manual - Nexus BI" },
  { path: "/explorer", marker: "Cargando tablas…" },
  { path: "/search", marker: "Búsqueda / Lupa" }
];

// Marcadores de pagina de error de Next.js/React que a veces se sirven con
// status 200 (error boundary del lado del cliente, notFound() mal manejado,
// etc.) - se buscan sobre el HTML SIN <script>/<style>, para no confundir
// codigo/CSS con contenido real de error.
const ERROR_MARKERS = [
  "application error",
  "unhandled runtime error",
  "this page could not be found",
  "internal server error",
  "500 - server error",
  "there was a problem",
  "no se pudo cargar",
  "cannot read propert",
  "is not a function",
  "unexpected token"
];

function stripScriptsAndStyles(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
}

async function checkRoute({ path, marker }) {
  const url = new URL(path, BASE_URL).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = performance.now();

  try {
    const res = await fetch(url, { signal: controller.signal });
    const html = await res.text();
    const durationMs = Math.round(performance.now() - startedAt);
    const cleaned = stripScriptsAndStyles(html).toLowerCase();

    if (res.status !== 200) {
      return { path, status: res.status, durationMs, result: "FAIL", reason: `status HTTP ${res.status} (se esperaba 200)` };
    }

    const foundErrorMarker = ERROR_MARKERS.find(m => cleaned.includes(m));
    if (foundErrorMarker) {
      return { path, status: res.status, durationMs, result: "FAIL", reason: `pagina de error detectada con status 200 (marcador: "${foundErrorMarker}")` };
    }

    if (!html.includes(marker)) {
      return { path, status: res.status, durationMs, result: "FAIL", reason: `marcador esperado no encontrado: "${marker}"` };
    }

    return { path, status: res.status, durationMs, result: "OK", reason: null };
  } catch (err) {
    const durationMs = Math.round(performance.now() - startedAt);
    const reason = err.name === "AbortError" ? `timeout tras ${TIMEOUT_MS}ms` : `error de red: ${err.message}`;
    return { path, status: null, durationMs, result: "FAIL", reason };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`Smoke test contra ${BASE_URL} (timeout ${TIMEOUT_MS}ms por ruta)\n`);

  const results = [];
  for (const route of ROUTES) {
    results.push(await checkRoute(route));
  }

  let failures = 0;
  for (const r of results) {
    const line = `[${r.result}] ${r.path.padEnd(28)} status=${String(r.status).padEnd(4)} ${String(r.durationMs).padStart(5)}ms`;
    if (r.result === "FAIL") {
      failures += 1;
      console.log(`${line}  -> ${r.reason}`);
    } else {
      console.log(line);
    }
  }

  console.log(`\n${results.length - failures}/${results.length} rutas OK`);

  if (failures > 0) {
    console.error(`\nsmoke test FALLO (${failures} ruta(s) con error).`);
    process.exit(1);
  }
  console.log("\nsmoke test OK.");
}

main();
