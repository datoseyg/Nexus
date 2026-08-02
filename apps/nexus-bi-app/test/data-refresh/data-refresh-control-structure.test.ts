// NEXUS V3 - verifica los escenarios del polling de DataRefreshControl.tsx
// que dependen del ciclo de vida real de React (montaje/desmontaje/remontaje,
// Strict Mode) y por lo tanto NO son expresables como funciones puras (esos
// viven en test/data-refresh/data-refresh-polling.test.ts). Igual que
// test/layout/root-layout-catch-isolation.test.ts: ni node
// --experimental-strip-types ni test/ts-extension-loader.mjs pueden importar
// un .tsx con JSX real, así que esto verifica la ESTRUCTURA del código
// fuente (con balanceo de llaves/paréntesis, nunca un simple substring) en
// vez de renderizar el componente. No reemplaza una verificación de
// comportamiento en un navegador real (fuera del alcance de este repo sin
// agregar jsdom/@testing-library - ver el reporte final de la tarea).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path: string): Promise<string> {
  return readFile(path, "utf8");
}

// Dado el índice de un carácter de apertura ("{", "(" o "["), devuelve el
// rango [start, end) de su cuerpo balanceando ese par de caracteres - nunca
// asume que el cuerpo cabe en una línea ni una indentación particular.
// Idéntico en espíritu a catchBodyRange() de root-layout-catch-isolation.test.ts,
// generalizado al par de caracteres (acá hace falta balancear tanto llaves
// como paréntesis, no solo llaves).
function balancedRange(src: string, openIndex: number, openChar: "{" | "(", closeChar: "}" | ")"): { start: number; end: number } {
  assert.equal(src[openIndex], openChar, `se esperaba "${openChar}" en el índice ${openIndex}`);
  let depth = 0;
  for (let i = openIndex; i < src.length; i++) {
    if (src[i] === openChar) depth++;
    else if (src[i] === closeChar) {
      depth--;
      if (depth === 0) return { start: openIndex + 1, end: i };
    }
  }
  throw new Error(`"${closeChar}" de cierre no encontrado desde el índice ${openIndex} - el archivo cambió de forma inesperada.`);
}

async function pollingEffect(): Promise<string> {
  const src = await source("components/data-refresh/DataRefreshControl.tsx");
  const anchor = src.indexOf("// Requisito 2 - loop único, recursivo");
  assert.ok(anchor >= 0, "no se encontró el comentario ancla del efecto de polling - DataRefreshControl.tsx cambió de forma inesperada");

  const useEffectOpenParen = src.indexOf("useEffect(", anchor);
  assert.ok(useEffectOpenParen >= 0, "no se encontró useEffect( después del comentario ancla");
  const callRange = balancedRange(src, useEffectOpenParen + "useEffect".length, "(", ")");

  return src.slice(callRange.start, callRange.end);
}

test("DataRefreshControl: existe EXACTAMENTE un useEffect de polling (nunca dos loops compitiendo)", async () => {
  const src = await source("components/data-refresh/DataRefreshControl.tsx");
  const pollLoopEffectMatches = [...src.matchAll(/useEffect\(/g)].filter(m => {
    // Cada useEffect real de este archivo - identificamos el de polling por
    // contener "pollLoop" dentro de su propio cuerpo balanceado, no por un
    // simple "cerca de la palabra pollLoop" (evita falsos positivos si se
    // agregara otro efecto que solo la mencione en un comentario).
    const range = balancedRange(src, m.index! + "useEffect".length, "(", ")");
    return src.slice(range.start, range.end).includes("function pollLoop");
  });
  assert.equal(pollLoopEffectMatches.length, 1, "debe existir un único useEffect que define pollLoop - dos lo duplicarían");
});

test("DataRefreshControl: el efecto de polling NUNCA depende de latestRun (causa raíz original del polling duplicado)", async () => {
  const effect = await pollingEffect();
  assert.doesNotMatch(effect, /latestRun/, "el efecto de polling no debe mencionar latestRun en absoluto - ni en su cuerpo ni en sus dependencias");
});

test("DataRefreshControl: el efecto de polling depende de [canObserve, fetchLatestRun, pollGeneration] (deps estables + el generador de reinicio)", async () => {
  const effect = await pollingEffect();
  assert.match(effect, /\},\s*\[canObserve,\s*fetchLatestRun,\s*pollGeneration\]\s*$/, "el array de dependencias debe ser exactamente [canObserve, fetchLatestRun, pollGeneration]");
});

test("DataRefreshControl: el cleanup del efecto marca cancelled=true Y limpia el timer (nunca deja timers colgando al desmontar)", async () => {
  const effect = await pollingEffect();
  const cleanupStart = effect.lastIndexOf("return () => {");
  assert.ok(cleanupStart >= 0, "no se encontró la función de cleanup del efecto");
  const cleanupRange = balancedRange(effect, cleanupStart + "return () => ".length, "{", "}");
  const cleanupBody = effect.slice(cleanupRange.start, cleanupRange.end);

  assert.match(cleanupBody, /cancelled\s*=\s*true/, "el cleanup debe marcar cancelled=true");
  assert.match(cleanupBody, /clearTimeout\(timer\)/, "el cleanup debe limpiar el timer pendiente con clearTimeout");
});

test("DataRefreshControl: pollLoop revisa 'cancelled' DESPUÉS de esperar fetchLatestRun() (cierra la carrera de Strict Mode)", async () => {
  const effect = await pollingEffect();
  const awaitIndex = effect.indexOf("await fetchLatestRun()");
  const cancelledCheckIndex = effect.indexOf("if (cancelled) return;");
  assert.ok(awaitIndex >= 0 && cancelledCheckIndex >= 0, "no se encontraron ambas líneas esperadas dentro del efecto de polling");
  assert.ok(
    awaitIndex < cancelledCheckIndex,
    "el chequeo de 'cancelled' debe ocurrir DESPUÉS del await - si una primera invocación (desmontada por Strict Mode) programara un timer ANTES de revisar 'cancelled', el remount duplicaría el loop"
  );
});

test("DataRefreshControl: la consulta inicial ocurre sin esperar el primer tick (pollLoop() se invoca directo, no dentro de un setTimeout)", async () => {
  const effect = await pollingEffect();
  assert.match(effect, /pollLoop\(\);\s*\/\//, "pollLoop() debe invocarse directamente al montar, no diferido detrás de un setTimeout inicial");
});

test("DataRefreshControl: tanto la actualización incremental como la FULL reinician el polling (bumpean pollGeneration) tras un POST exitoso", async () => {
  const src = await source("components/data-refresh/DataRefreshControl.tsx");

  for (const fnName of ["handleIncremental", "handleFullConfirmed"]) {
    const fnStart = src.indexOf(`async function ${fnName}(`);
    assert.ok(fnStart >= 0, `no se encontró ${fnName}`);
    const bodyOpen = src.indexOf("{", fnStart);
    const body = src.slice(bodyOpen, balancedRange(src, bodyOpen, "{", "}").end + 1);
    assert.match(body, /setPollGeneration\(g\s*=>\s*g\s*\+\s*1\)/, `${fnName} debe reiniciar el polling (setPollGeneration) tras un POST 202 exitoso`);
  }
});

test("AppShell: Sidebar (y por lo tanto DataRefreshControl, montado dentro) nunca se renderiza en /login", async () => {
  const src = await source("components/layout/AppShell.tsx");

  const publicRouteDeclIndex = src.indexOf('const publicRoute = pathname === "/login"');
  assert.ok(publicRouteDeclIndex >= 0, "no se encontró la declaración de publicRoute apuntando a /login");

  const earlyReturnIndex = src.indexOf("if (publicRoute || !userLabel) return children;");
  assert.ok(earlyReturnIndex >= 0, "no se encontró el early return de AppShell para rutas públicas/sin sesión");

  const sidebarRenderIndex = src.indexOf("<Sidebar");
  assert.ok(sidebarRenderIndex >= 0, "no se encontró el render de <Sidebar");

  assert.ok(
    publicRouteDeclIndex < earlyReturnIndex && earlyReturnIndex < sidebarRenderIndex,
    "el early return de /login debe ejecutarse ANTES de llegar al render de <Sidebar> - si no, DataRefreshControl (montado dentro de Sidebar) llamaría a la API también en /login"
  );
});
