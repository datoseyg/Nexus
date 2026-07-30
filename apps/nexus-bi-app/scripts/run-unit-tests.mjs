import { spawn } from "node:child_process";
import { glob } from "node:fs/promises";

const directories = ["test/after-hours", "test/audit", "test/auth", "test/explorer", "test/fieldbeat"];
const files = [];

for (const directory of directories) {
  for await (const file of glob(`${directory}/*.test.ts`)) {
    if (!file.endsWith(".integration.test.ts")) files.push(file);
  }
}
files.sort();

if (files.length === 0) {
  console.error("No se encontraron pruebas unitarias TypeScript.");
  process.exit(1);
}

const child = spawn(
  process.execPath,
  ["--experimental-strip-types", "--experimental-loader=./test/ts-extension-loader.mjs", "--test", ...files],
  { stdio: "inherit", env: { ...process.env, NODE_ENV: "test" } }
);

child.on("error", error => {
  console.error(error);
  process.exit(1);
});
child.on("exit", code => process.exit(code ?? 1));
