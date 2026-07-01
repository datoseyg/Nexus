import "dotenv/config";
import { fileURLToPath } from "node:url";
import { getJson, basicAuth } from "../lib/http.js";
import { saveJson, timestampForFile } from "../lib/save-json.js";

const {
  FIELDBEAT_API_BASE_URL,
  FIELDBEAT_API_USER,
  FIELDBEAT_API_PASS,
  FIELDBEAT_TASK_IDS
} = process.env;

export async function mineFieldBeatTasks() {
    if (!FIELDBEAT_API_BASE_URL || !FIELDBEAT_API_USER || !FIELDBEAT_API_PASS) {
        throw new Error(
        "Faltan variables FIELDBEAT_API_BASE_URL, FIELDBEAT_API_USER o FIELDBEAT_API_PASS en .env"
        );
    }

    const taskIds = String(FIELDBEAT_TASK_IDS || "")
        .split(",")
        .map(id => id.trim())
        .filter(Boolean);

    if (taskIds.length === 0) {
        throw new Error("No hay FIELDBEAT_TASK_IDS en .env. Ejemplo: FIELDBEAT_TASK_IDS=3780,3781");
    }

    const authHeader = basicAuth(FIELDBEAT_API_USER, FIELDBEAT_API_PASS);

    let total = 0;


    const url = `${FIELDBEAT_API_BASE_URL}`;

    try {
        const data = await getJson(url, {
        headers: {
            Authorization: authHeader
        }
        });

        await saveJson(
        `data/raw/fieldbeat/task_${taskId}_${timestampForFile()}.json`,
        data
        );

        total++;
} catch (error) {
    console.error(`Error task ${taskId}: ${error.message}`);
}
  

  console.log(`FieldBeat finalizado. Tareas descargadas: ${total}`);
  return total;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  mineFieldBeatTasks().catch(error => {
    console.error(error);
    process.exit(1);
  });
}