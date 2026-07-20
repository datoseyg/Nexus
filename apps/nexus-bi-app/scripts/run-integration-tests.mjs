// `node --test` con un glob de VARIOS archivos NO serializa de forma
// confiable el before()/tests/after() de cada archivo entre sí, ni
// siquiera con --test-concurrency=1 (verificado empíricamente, ETAPA
// 6.6D): dos archivos de integración que comparten el mismo Postgres
// desechable y hacen TRUNCATE/DELETE + INSERT de sus propios fixtures en
// las mismas tablas pueden interfoliarse durante el traspaso entre
// procesos hijos, contaminando los conteos "sin filtro" del otro archivo
// (confirmado: mismos 2 archivos, mismos fixtures, 0 fallas al correrlos
// como dos procesos `node --test` genuinamente secuenciales; fallas
// intermitentes al correrlos como un solo `node --test` con glob).
//
// Este script reemplaza el glob único por N invocaciones de `node --test`
// -una por archivo- ejecutadas estrictamente en secuencia (cada proceso
// hijo termina por completo antes de que arranque el siguiente), sin
// hardcodear los nombres de archivo -escala automáticamente a cualquier
// *.integration.test.ts nuevo bajo test/after-hours/.
import { spawn } from "node:child_process";
import { glob } from "node:fs/promises";

const files = [];
for await (const f of glob("test/after-hours/*.integration.test.ts")) files.push(f);
files.sort();

if (files.length === 0) {
  console.error("No se encontró ningún test/after-hours/*.integration.test.ts");
  process.exit(1);
}

function runOne(file) {
  return new Promise((resolve, reject) => {
    console.log(`\n=== ${file} ===`);
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--experimental-loader=./test/ts-extension-loader.mjs", "--test", file],
      { stdio: "inherit" }
    );
    child.on("exit", code => (code === 0 ? resolve() : reject(new Error(`${file} salió con código ${code}`))));
    child.on("error", reject);
  });
}

for (const file of files) {
  await runOne(file);
}

console.log(`\n=== ${files.length} archivo(s) de integración, todos verdes ===`);
