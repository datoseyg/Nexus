// NEXUS V3 - resolveRefreshEnvironment/resolveRefreshExecutorType
// (app/api/data-refresh/runs/route.ts). Corrección focal post-revisión de
// producto: LOCAL por defecto (variable ausente) es aceptable en
// desarrollo/test, pero debe fallar cerrado en un runtime productivo real
// (NODE_ENV=production, la misma señal que next build/next start fijan de
// forma incondicional y que netlify.toml despliega vía `npm run build`) -
// una omisión de configuración en Netlify nunca debe crear corridas LOCAL
// en una base remota que ningún worker local puede procesar.
//
// Unitaria, sin DB, sin red - ambas funciones son puras sobre process.env.
// El resto del contrato de la ruta (el body HTTP nunca puede forzar otro
// entorno, el dispatch real a GitHub, retry/replay) ya tiene cobertura de
// integración propia en test/pipeline/data-refresh-dispatch.integration.test.ts
// y no depende de esta corrección (solo cambia qué pasa cuando la variable
// está ausente o es LOCAL explícito bajo NODE_ENV=production, algo que esa
// suite nunca ejercita - siempre corre bajo NODE_ENV=test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRefreshEnvironment, resolveRefreshExecutorType } from "../../app/api/data-refresh/runs/route.ts";

// Guarda y restaura NODE_ENV/NEXUS_REFRESH_ENVIRONMENT con precisión (incluso
// "ausente" vs "string vacío") - crítico acá: el resto de la suite de
// integración depende de NODE_ENV=test para setAuthorizationProviderForTests
// (ver lib/auth/authorization.ts:19) - dejarlo mutado rompería cualquier test
// que corra después en el mismo proceso, dentro o fuera de este archivo.
function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) original[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("resolveRefreshEnvironment: desarrollo (NODE_ENV=development), variable ausente -> LOCAL", () => {
  withEnv({ NODE_ENV: "development", NEXUS_REFRESH_ENVIRONMENT: undefined }, () => {
    assert.equal(resolveRefreshEnvironment(), "LOCAL");
  });
});

test("resolveRefreshEnvironment: test/CI (NODE_ENV=test), variable ausente -> LOCAL (mismo trato que desarrollo, nunca productivo)", () => {
  withEnv({ NODE_ENV: "test", NEXUS_REFRESH_ENVIRONMENT: undefined }, () => {
    assert.equal(resolveRefreshEnvironment(), "LOCAL");
  });
});

test("resolveRefreshEnvironment: deployment productivo (NODE_ENV=production), variable ausente -> falla cerrado con error explícito de configuración", () => {
  withEnv({ NODE_ENV: "production", NEXUS_REFRESH_ENVIRONMENT: undefined }, () => {
    assert.throws(
      () => resolveRefreshEnvironment(),
      /NEXUS_REFRESH_ENVIRONMENT.*deployment productivo/,
      "el error debe nombrar la variable faltante y explicar que es un deployment productivo"
    );
  });
});

test("resolveRefreshEnvironment: producción + NEXUS_REFRESH_ENVIRONMENT=PRODUCTION -> PRODUCTION", () => {
  withEnv({ NODE_ENV: "production", NEXUS_REFRESH_ENVIRONMENT: "PRODUCTION" }, () => {
    assert.equal(resolveRefreshEnvironment(), "PRODUCTION");
  });
});

test("resolveRefreshEnvironment: producción + NEXUS_REFRESH_ENVIRONMENT=STAGING -> STAGING", () => {
  withEnv({ NODE_ENV: "production", NEXUS_REFRESH_ENVIRONMENT: "STAGING" }, () => {
    assert.equal(resolveRefreshEnvironment(), "STAGING");
  });
});

test("resolveRefreshEnvironment: producción + NEXUS_REFRESH_ENVIRONMENT=LOCAL explícito -> también falla cerrado (sin excepción documentada para permitirlo)", () => {
  withEnv({ NODE_ENV: "production", NEXUS_REFRESH_ENVIRONMENT: "LOCAL" }, () => {
    assert.throws(
      () => resolveRefreshEnvironment(),
      /LOCAL.*NODE_ENV=production/,
      "un LOCAL explícito en un runtime productivo debe rechazarse igual que uno ausente - ADR 0001 nunca documenta ese caso como válido"
    );
  });
});

test("resolveRefreshEnvironment: desarrollo + NEXUS_REFRESH_ENVIRONMENT=LOCAL explícito -> sigue permitido (comportamiento original, sin cambios fuera de producción)", () => {
  withEnv({ NODE_ENV: "development", NEXUS_REFRESH_ENVIRONMENT: "LOCAL" }, () => {
    assert.equal(resolveRefreshEnvironment(), "LOCAL");
  });
});

test("resolveRefreshEnvironment: valor inválido (typo) -> falla cerrado sin importar NODE_ENV", () => {
  withEnv({ NODE_ENV: "development", NEXUS_REFRESH_ENVIRONMENT: "producción" }, () => {
    assert.throws(() => resolveRefreshEnvironment(), /inválido/);
  });
  withEnv({ NODE_ENV: "production", NEXUS_REFRESH_ENVIRONMENT: "producción" }, () => {
    assert.throws(() => resolveRefreshEnvironment(), /inválido/);
  });
});

test("resolveRefreshExecutorType: LOCAL->LOCAL, STAGING/PRODUCTION->GITHUB - regla sin cambios por esta corrección", () => {
  assert.equal(resolveRefreshExecutorType("LOCAL"), "LOCAL");
  assert.equal(resolveRefreshExecutorType("STAGING"), "GITHUB");
  assert.equal(resolveRefreshExecutorType("PRODUCTION"), "GITHUB");
});
