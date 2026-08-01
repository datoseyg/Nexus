import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Regresión real (2026-08-01): app/layout.tsx transitivamente importa
// "./globals.css" y JSX propio - ni node --experimental-strip-types ni el
// loader de test/ts-extension-loader.mjs pueden cargar un .tsx con sintaxis
// JSX real (confirmado: "Unknown file extension .tsx" al intentar
// importarlo directo) - mismo límite ya documentado en
// test/auth/auth-wiring.test.ts y test/explorer/explorer-filters-config.test.ts.
// Por eso este test verifica la ESTRUCTURA real del código fuente (con
// balanceo de llaves, no un simple substring) en vez de importar y ejecutar
// RootLayout. La verificación de comportamiento renderizado real (con login
// de verdad) vive en scripts/verify-sidebar-visual.mjs, ejecutado a mano
// contra un servidor real (no automatizable sin credenciales reales - ver
// ese archivo).
async function source(path: string): Promise<string> {
  return readFile(path, "utf8");
}

// Dado el índice de un "catch" (apuntando al primer "{" que abre su
// cuerpo), devuelve el rango [start, end) del cuerpo del catch balanceando
// llaves - nunca asume que el cuerpo cabe en una sola línea ni una forma de
// indentación particular.
function catchBodyRange(src: string, openBraceIndex: number): { start: number; end: number } {
  assert.equal(src[openBraceIndex], "{", `se esperaba "{" en el índice ${openBraceIndex}`);
  let depth = 0;
  for (let i = openBraceIndex; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return { start: openBraceIndex + 1, end: i };
    }
  }
  throw new Error("Llave de cierre de catch no encontrada - RootLayout cambió de forma inesperada.");
}

function findAllCatchBraces(src: string): number[] {
  const indices: number[] = [];
  const pattern = /catch\s*(\([^)]*\))?\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(src))) {
    indices.push(match.index + match[0].length - 1);
  }
  return indices;
}

test("RootLayout: fetchCapabilitiesForRole está en su PROPIO catch, nunca en el que resetea userLabel a null", async () => {
  const layoutSource = await source("app/layout.tsx");

  const fnStart = layoutSource.indexOf("export default async function RootLayout");
  assert.ok(fnStart >= 0, "no se encontró RootLayout - el archivo cambió de forma inesperada");

  // La firma es "({ children }: { children: React.ReactNode })" - tiene
  // sus propias llaves ANTES de la llave que abre el cuerpo real de la
  // función, así que hay que balancear PARÉNTESIS de la lista de
  // parámetros primero (nunca asumir que el primer "{" tras el nombre de
  // la función ya es el cuerpo).
  const paramListOpenParen = layoutSource.indexOf("(", fnStart);
  let parenDepth = 0;
  let paramListEnd = -1;
  for (let i = paramListOpenParen; i < layoutSource.length; i++) {
    if (layoutSource[i] === "(") parenDepth++;
    else if (layoutSource[i] === ")") {
      parenDepth--;
      if (parenDepth === 0) { paramListEnd = i; break; }
    }
  }
  assert.ok(paramListEnd > 0, "no se pudo balancear la lista de parámetros de RootLayout");

  const fnBodyStart = layoutSource.indexOf("{", paramListEnd);
  const fnBody = layoutSource.slice(fnStart, catchBodyRange(layoutSource, fnBodyStart).end + 1);

  const catchBraceIndices = findAllCatchBraces(fnBody);
  assert.ok(catchBraceIndices.length >= 2, `se esperaban al menos 2 bloques catch en RootLayout (uno para requireAuthenticatedUser, otro para fetchCapabilitiesForRole) - se encontraron ${catchBraceIndices.length}`);

  const catchBodies = catchBraceIndices.map(idx => {
    const range = catchBodyRange(fnBody, idx);
    return fnBody.slice(range.start, range.end);
  });

  const nullingCatch = catchBodies.find(body => /userLabel\s*=\s*null/.test(body));
  assert.ok(nullingCatch !== undefined, "debe existir un catch que resetea userLabel a null (el de requireAuthenticatedUser)");

  // LA aserción central de esta regresión: ese catch específico NUNCA debe
  // mencionar fetchCapabilitiesForRole - si lo hiciera, sería la señal de
  // que ambas llamadas volvieron a compartir un solo try/catch.
  assert.doesNotMatch(
    nullingCatch,
    /fetchCapabilitiesForRole/,
    "el catch que resetea userLabel a null nunca debe estar asociado a fetchCapabilitiesForRole - una falla ahí no debe poder borrar una autenticación ya válida (regresión 2026-08-01: sidebar izquierdo desaparecía completo)"
  );

  const capabilitiesCatch = catchBodies.find(body => body !== nullingCatch);
  assert.ok(capabilitiesCatch !== undefined, "debe existir un segundo catch, separado, para fetchCapabilitiesForRole");
  assert.doesNotMatch(capabilitiesCatch, /userLabel\s*=\s*null/, "el catch de fetchCapabilitiesForRole nunca debe tocar userLabel");

  // El catch de capacidades debe registrar el error (nunca silenciarlo del
  // todo - un fallo de gobierno tras un login válido debe quedar en logs,
  // no desaparecer sin rastro).
  assert.match(capabilitiesCatch, /console\.error/, "una falla al resolver capacidades debe quedar registrada, nunca silenciada por completo");
});

test("RootLayout: fetchCapabilitiesForRole se llama DESPUÉS de fijar userLabel, no antes", async () => {
  const layoutSource = await source("app/layout.tsx");
  const userLabelAssignIndex = layoutSource.indexOf("userLabel = user.label");
  const fetchCallIndex = layoutSource.indexOf("await fetchCapabilitiesForRole(");
  assert.ok(userLabelAssignIndex >= 0 && fetchCallIndex >= 0, "no se encontraron ambas líneas esperadas en app/layout.tsx");
  assert.ok(userLabelAssignIndex < fetchCallIndex, "userLabel debe fijarse ANTES de intentar resolver capacidades, para que una falla posterior no tenga nada que borrar retroactivamente");
});
