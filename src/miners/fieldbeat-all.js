import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const {
  FIELDBEAT_API_BASE_URL,
  FIELDBEAT_API_USER,
  FIELDBEAT_API_PASS,
  FIELDBEAT_MAX_PAGES = "1000"
} = process.env;

const MAX_PAGES = Number(FIELDBEAT_MAX_PAGES);

function assertEnv() {
  if (!FIELDBEAT_API_BASE_URL || !FIELDBEAT_API_USER || !FIELDBEAT_API_PASS) {
    throw new Error(
      "Faltan variables en .env: FIELDBEAT_API_BASE_URL, FIELDBEAT_API_USER, FIELDBEAT_API_PASS"
    );
  }
}

function basicAuth(user, pass) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function saveJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  console.log(`RAW guardado: ${filePath}`);
}

async function getJson(url, authHeader) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: authHeader
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `GET ${url} falló con ${response.status} ${response.statusText}\n${text}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`La respuesta de ${url} no es JSON válido:\n${text}`);
  }
}

function buildFieldBeatUrl(nextPageToken) {
  if (!nextPageToken) {
    return FIELDBEAT_API_BASE_URL;
  }

  // FieldBeat devuelve el cursor en "next_page",
  // pero el request siguiente debe enviarlo como parámetro "page".
  // No usar URLSearchParams aquí porque el token ya viene URL-encoded.
  return `${FIELDBEAT_API_BASE_URL}?page=${nextPageToken}`;
}

function extractTasks(payload) {
  if (!payload) return [];

  if (Array.isArray(payload.tasks)) return payload.tasks;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload)) return payload;

  return [];
}

function extractNextPage(payload) {
  return payload?.next_page || "";
}

function extractTaskId(task) {
  return String(task?.task_id ?? task?.id ?? "").trim();
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function mineAllFieldBeatTasks() {
  assertEnv();

  const startedAt = new Date();
  const authHeader = basicAuth(FIELDBEAT_API_USER, FIELDBEAT_API_PASS);

  console.log("=== FieldBeat Miner Local | Cursor pagination ===");

  let nextPageToken = "";
  let page = 0;

  const allTasks = [];
  const seenTaskIds = new Set();

  while (page < MAX_PAGES) {
    const url = buildFieldBeatUrl(nextPageToken);

    console.log(`Descargando FieldBeat page ${page + 1}: ${url}`);

    const payload = await getJson(url, authHeader);

    await saveJson(
      `data/raw/fieldbeat/list_pages/page_${page + 1}_${timestampForFile()}.json`,
      payload
    );

    const tasks = extractTasks(payload);
    console.log(`Página ${page + 1}: ${tasks.length} tasks`);

    for (const task of tasks) {
      const taskId = extractTaskId(task);

      if (!taskId) continue;
      if (seenTaskIds.has(taskId)) continue;

      seenTaskIds.add(taskId);
      allTasks.push(task);
    }

    nextPageToken = extractNextPage(payload);

    if (!nextPageToken) {
      console.log("No hay next_page. Fin de paginación.");
      break;
    }

    page++;
    await sleep(250);
  }

  await saveJson("data/raw/fieldbeat/all_tasks_latest.json", {
    extracted_at: new Date().toISOString(),
    total: allTasks.length,
    task_ids: allTasks.map(t => t.task_id),
    tasks: allTasks
  });

  await saveJson("data/raw/fieldbeat/task_index.json", {
    extracted_at: new Date().toISOString(),
    total: allTasks.length,
    task_ids: allTasks.map(t => t.task_id)
  });

  const finishedAt = new Date();

  console.log("=== FieldBeat Miner finalizado ===");
  console.log(`Inicio: ${startedAt.toISOString()}`);
  console.log(`Fin:    ${finishedAt.toISOString()}`);
  console.log(`Tasks únicas descargadas: ${allTasks.length}`);

  return {
    started_at: startedAt,
    finished_at: finishedAt,
    total_tasks: allTasks.length
  };
}

// EJECUCIÓN DIRECTA LOCAL
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  mineAllFieldBeatTasks().catch(error => {
    console.error("ERROR FIELDBEAT MINER:");
    console.error(error);
    process.exit(1);
  });
}