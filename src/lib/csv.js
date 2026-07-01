import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";

export function csvEscape(value) {
  if (value === null || value === undefined) return "";

  const str = String(value);

  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export async function writeCsv(filePath, rows) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  if (!rows.length) {
    await fs.writeFile(filePath, "", "utf8");
    console.log(`CSV vacío: ${filePath}`);
    return;
  }

  const headers = Object.keys(rows[0]);

  const csv = [
    headers.join(","),
    ...rows.map(row => headers.map(h => csvEscape(row[h])).join(","))
  ].join("\n");

  await fs.writeFile(filePath, csv, "utf8");
  console.log(`CSV generado: ${filePath} (${rows.length} filas)`);
}

export async function readCsv(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");

    if (!raw.trim()) return [];

    return parse(raw, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
  } catch (error) {
    console.warn(`No se pudo leer ${filePath}: ${error.message}`);
    return [];
  }
}
