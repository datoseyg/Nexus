import fs from "node:fs/promises";
import path from "node:path";

export async function saveJson(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  await fs.writeFile(
    filePath,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  console.log(`Guardado: ${filePath}`);
}

export function timestampForFile() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "-");
}