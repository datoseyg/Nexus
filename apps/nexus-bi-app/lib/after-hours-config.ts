import fs from "node:fs/promises";
import path from "node:path";

// apps/nexus-bi-app/ vive dos niveles bajo la raíz del proyecto - mismo
// convenio de path que lib/duckdb.ts. Solo lectura, nunca se escribe
// config desde la app.
const CONFIG_DIR = path.join(process.cwd(), "..", "..", "data", "config");

interface ConfigStatusDoc {
  status?: string;
}

async function readJsonSoft(fileName: string): Promise<ConfigStatusDoc | null> {
  try {
    const raw = await fs.readFile(path.join(CONFIG_DIR, fileName), "utf8");
    return JSON.parse(raw) as ConfigStatusDoc;
  } catch {
    return null;
  }
}

// Status de los inputs de política que alimentan la confiabilidad (factores
// 4 y 5 de calculation-confidence.js) - ver docs/CALCULATION_CONFIDENCE_MODEL.md.
export async function getAfterHoursConfigStatus(): Promise<{ businessHoursStatus: string; holidaysStatus: string }> {
  const businessHours = await readJsonSoft("business-hours.json");
  const holidaysReal = await readJsonSoft("holidays.json");
  const holidaysExample = holidaysReal ? null : await readJsonSoft("holidays.example.json");

  return {
    businessHoursStatus: businessHours?.status || "MISSING",
    holidaysStatus: holidaysReal?.status || holidaysExample?.status || "MISSING"
  };
}
