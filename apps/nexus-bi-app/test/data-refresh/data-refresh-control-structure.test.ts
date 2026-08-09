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

// Blocker de revisión de producto - "el botón real sigue siendo LOCAL": el
// componente ya no debe enviar/leer environment ni executorType en ningún
// punto - el backend los resuelve server-side (route.ts::resolveRefreshEnvironment).
// Estos tests son la red de regresión barata (sin DB, sin red) para que un
// futuro cambio no reintroduzca esos campos en el body/query del cliente.
test("DataRefreshControl: startRun() (POST) NUNCA envía environment/executorType en el body - el backend los resuelve", async () => {
  const src = await source("components/data-refresh/DataRefreshControl.tsx");
  const fnStart = src.indexOf("async function startRun(");
  assert.ok(fnStart >= 0, "no se encontró startRun()");
  // El primer "{" tras la firma es el del TIPO de retorno (Promise<{ status:
  // ...; dispatch?: ... }>), no el del cuerpo - se salta ese objeto-literal
  // balanceado (reconocible porque su cierre queda seguido de ">", el cierre
  // del genérico Promise<...>) antes de buscar el "{" real del cuerpo.
  let braceIndex = src.indexOf("{", fnStart);
  let range = balancedRange(src, braceIndex, "{", "}");
  while (src[range.end + 1] === ">") {
    braceIndex = src.indexOf("{", range.end + 1);
    range = balancedRange(src, braceIndex, "{", "}");
  }
  const body = src.slice(range.start, range.end);

  assert.doesNotMatch(body, /\bexecutorType\b/, "startRun() no debe mencionar executorType en absoluto - ni leerlo ni enviarlo");
  assert.match(body, /JSON\.stringify\(\{\s*mode:\s*options\.mode,\s*confirmed:\s*options\.confirmed,\s*reason:\s*options\.reason\s*\}\)/, "el body del POST debe ser exactamente {mode, confirmed, reason}");
});

test("DataRefreshControl: fetchRunsList() (GET) NUNCA envía ?environment= - el backend lo resuelve", async () => {
  const src = await source("components/data-refresh/DataRefreshControl.tsx");
  const fnStart = src.indexOf("async function fetchRunsList(");
  assert.ok(fnStart >= 0, "no se encontró fetchRunsList()");
  const bodyOpen = src.indexOf("{", fnStart);
  const body = src.slice(bodyOpen, balancedRange(src, bodyOpen, "{", "}").end + 1);

  // El comentario dentro del cuerpo SÍ menciona "environment" a propósito
  // (documenta por qué se omite) - lo que nunca debe aparecer es la URL con
  // un query param real.
  assert.doesNotMatch(body, /\?environment=/, "fetchRunsList() no debe enviar ningún query param environment=");
  assert.match(body, /\/api\/data-refresh\/runs\?limit=5/, "el GET debe pedir solo ?limit=5, sin filtro de entorno");
});

// Blocker de revisión de producto - "el UI debe mostrar claramente si la
// activación del worker remoto falló" y "permitir una recuperación
// coherente": dispatchWarning es un estado DISTINTO de `error` (nunca se
// confunden - un dispatch fallido no es un request fallido), y el botón
// principal debe reactivarse para reintentar mientras la corrida siga
// QUEUED por esa razón.
test("DataRefreshControl: existe un estado dispatchWarning separado de error, poblado desde result.dispatch cuando falla", async () => {
  const src = await source("components/data-refresh/DataRefreshControl.tsx");
  assert.match(src, /const \[dispatchWarning, setDispatchWarning\] = useState<string \| null>\(null\)/, "debe existir un estado dispatchWarning propio, distinto de error");

  for (const fnName of ["handleIncremental", "handleFullConfirmed"]) {
    const fnStart = src.indexOf(`async function ${fnName}(`);
    assert.ok(fnStart >= 0, `no se encontró ${fnName}`);
    const bodyOpen = src.indexOf("{", fnStart);
    const body = src.slice(bodyOpen, balancedRange(src, bodyOpen, "{", "}").end + 1);
    assert.match(
      body,
      /if \(result\.dispatch && !result\.dispatch\.ok\) setDispatchWarning\(/,
      `${fnName} debe poblar dispatchWarning cuando result.dispatch.ok es false, sin confundirlo con result.error`
    );
  }
});

test("DataRefreshControl: el botón principal se reactiva para reintentar (canRetryDispatch) cuando la corrida sigue QUEUED por un dispatch fallido", async () => {
  const src = await source("components/data-refresh/DataRefreshControl.tsx");
  assert.match(
    src,
    /const canRetryDispatch = isActive && latestRun\?\.status === "QUEUED" && Boolean\(dispatchWarning\)/,
    "debe existir canRetryDispatch, activo solo mientras la corrida sigue QUEUED y hay una advertencia de dispatch pendiente"
  );

  const buttonStart = src.indexOf("onClick={handleIncremental}");
  assert.ok(buttonStart >= 0, "no se encontró el botón principal (onClick={handleIncremental})");
  const disabledIndex = src.indexOf("disabled={", buttonStart);
  assert.ok(disabledIndex >= 0 && disabledIndex - buttonStart < 200, "no se encontró el prop disabled del botón principal cerca de su onClick");
  const disabledRange = balancedRange(src, disabledIndex + "disabled=".length, "{", "}");
  const disabledExpr = src.slice(disabledRange.start, disabledRange.end);
  assert.match(disabledExpr, /!canRetryDispatch/, "el botón principal debe reactivarse (nunca quedar deshabilitado por isActive) cuando canRetryDispatch es true");
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
