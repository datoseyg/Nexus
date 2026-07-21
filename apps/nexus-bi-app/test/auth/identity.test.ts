import assert from "node:assert/strict";
import test from "node:test";
import { resolveVisibleIdentity } from "../../lib/auth/identity.ts";

test("GERENCIA se resuelve desde configuración server-only sin exponer el correo en la identidad pública", () => {
  const resolved = resolveVisibleIdentity("GERENCIA", {
    gerenciaEmail: "gerencia@example.invalid",
    administracionEmail: "administracion@example.invalid"
  });

  assert.deepEqual(resolved.publicIdentity, {
    role: "gerencia",
    label: "Gerencia"
  });
  assert.equal(resolved.email, "gerencia@example.invalid");
  assert.equal("email" in resolved.publicIdentity, false);
});

test("ADMINISTRACION se resuelve con su rol y etiqueta confiables", () => {
  const resolved = resolveVisibleIdentity("ADMINISTRACION", {
    gerenciaEmail: "gerencia@example.invalid",
    administracionEmail: "administracion@example.invalid"
  });

  assert.equal(resolved.email, "administracion@example.invalid");
  assert.deepEqual(resolved.publicIdentity, {
    role: "administracion",
    label: "Administración"
  });
});

test("un ID desconocido se rechaza", () => {
  assert.throws(() =>
    resolveVisibleIdentity("DIRECCION", {
      gerenciaEmail: "gerencia@example.invalid",
      administracionEmail: "administracion@example.invalid"
    })
  );
});

test("no acepta espacios, minúsculas ni variantes Unicode ambiguas", () => {
  const configuration = {
    gerenciaEmail: "gerencia@example.invalid",
    administracionEmail: "administracion@example.invalid"
  };

  for (const visibleId of [" GERENCIA", "GERENCIA ", "gerencia", "GERENCIA\n", "ＧＥＲＥＮＣＩＡ"]) {
    assert.throws(() => resolveVisibleIdentity(visibleId, configuration), visibleId);
  }
});

test("una identidad permitida sin correo técnico configurado falla cerrada", () => {
  assert.throws(() =>
    resolveVisibleIdentity("GERENCIA", {
      gerenciaEmail: "",
      administracionEmail: "administracion@example.invalid"
    })
  );
});
