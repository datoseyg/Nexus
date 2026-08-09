import { test } from "node:test";
import assert from "node:assert/strict";
import * as ddlModule from "../../src/db/generate-postgres-ddl.js";

test("DDL idéntico no vuelve a abrir el archivo para escritura", async () => {
  assert.equal(typeof ddlModule.writeFileIfChanged, "function", "falta writeFileIfChanged");
  let writes = 0;
  const result = await ddlModule.writeFileIfChanged("sql/example.sql", "same", {
    readFile: async () => "same",
    writeFile: async () => {
      writes++;
      throw new Error("no debería escribir contenido idéntico");
    }
  });
  assert.deepEqual(result, { changed: false });
  assert.equal(writes, 0);
});

test("DDL distinto sí actualiza el archivo", async () => {
  assert.equal(typeof ddlModule.writeFileIfChanged, "function", "falta writeFileIfChanged");
  let written = null;
  const result = await ddlModule.writeFileIfChanged("sql/example.sql", "new", {
    readFile: async () => "old",
    writeFile: async (_path, content, encoding) => {
      written = { content, encoding };
    }
  });
  assert.deepEqual(result, { changed: true });
  assert.deepEqual(written, { content: "new", encoding: "utf8" });
});
