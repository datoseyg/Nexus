import { spawn } from "node:child_process";
import { glob } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const INTEGRATION_ENV_BY_DIRECTORY = new Map([
  ["test/contracts", ["CONTRACTS_TEST_DATABASE_URL", "CONTRACTS_TEST_RUN_ID"]],
  ["test/holidays", ["HOLIDAYS_TEST_DATABASE_URL", "HOLIDAYS_TEST_RUN_ID"]],
  ["test/working-hours", ["WORKING_HOURS_TEST_DATABASE_URL", "WORKING_HOURS_TEST_RUN_ID"]]
]);

export function selectTestFiles(files, mode) {
  if (mode !== "unit" && mode !== "integration") {
    throw new Error(`Modo inválido: ${mode}. Use unit o integration.`);
  }

  return [...files]
    .filter(file => mode === "integration"
      ? file.endsWith(".integration.test.js")
      : file.endsWith(".test.js") && !file.endsWith(".integration.test.js"))
    .sort();
}

export function assertIntegrationEnvironment(testDir, env = process.env) {
  const normalizedDir = testDir.replaceAll("\\", "/").replace(/\/$/, "");
  const required = INTEGRATION_ENV_BY_DIRECTORY.get(normalizedDir);
  if (!required) throw new Error(`No existe contrato de entorno para la suite de integración ${normalizedDir}.`);
  const missing = required.filter(name => !env[name]);
  if (missing.length > 0) {
    throw new Error(`Integración abortada antes de ejecutar: faltan ${missing.join(" y ")}. No se aceptan suites omitidas.`);
  }
}

function runNodeTest(files) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--test", ...files], { stdio: "inherit" });
    child.on("exit", code => code === 0
      ? resolve()
      : reject(new Error(`node --test salió con código ${code}`)));
    child.on("error", reject);
  });
}

export async function runTestSuite(testDir, mode) {
  const normalizedDir = testDir.replaceAll("\\", "/").replace(/\/$/, "");
  const discovered = [];
  for await (const file of glob(`${normalizedDir}/*.test.js`)) discovered.push(file);
  const files = selectTestFiles(discovered, mode);

  if (files.length === 0) {
    throw new Error(`No se encontraron pruebas ${mode} en ${testDir}`);
  }

  if (mode === "integration") assertIntegrationEnvironment(normalizedDir);

  if (mode === "unit") {
    await runNodeTest(files);
  } else {
    for (const file of files) {
      console.log(`\n=== ${file} ===`);
      await runNodeTest([file]);
    }
  }

  console.log(`\n=== ${files.length} archivo(s) ${mode}, todos verdes ===`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [, , testDir, mode] = process.argv;
  await runTestSuite(testDir, mode);
}
