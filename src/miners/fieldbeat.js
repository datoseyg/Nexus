import "dotenv/config";
import { fileURLToPath } from "node:url";

const { FIELDBEAT_API_BASE_URL, FIELDBEAT_API_USER, FIELDBEAT_API_PASS, FIELDBEAT_TASK_IDS } = process.env;

// DEPRECATED - detectado roto en la auditoría de estructura del
// 2026-07-04 (ver docs/PROJECT_CLEANUP_CANDIDATES.md): esta función
// declaraba `taskIds` (plural) pero nunca iteraba sobre la lista, y
// usaba una variable `taskId` (singular) que no existía en ningún
// scope - correrla lanzaba un ReferenceError.
//
// No se "arregló" adivinando el endpoint de FieldBeat para traer UNA
// tarea por ID, porque ese endpoint nunca quedó documentado en
// CLAUDE.md ni se ve usado en ningún otro lugar del repo (el único
// endpoint FieldBeat confirmado es el de listado paginado por cursor,
// ver src/miners/fieldbeat-all.js) - adivinar mal la URL sería peor que
// no correr nada: quedaría un miner que "funciona" pero trae datos
// incorrectos en silencio.
//
// Usar en su lugar:
//   npm run get:fieldbeat:all   (miner real, paginación por cursor next_page)
//   npm run get:all             (corre los 3 miners, incluye fieldbeat-all)
//
// Si en algún momento se confirma el contrato real del endpoint
// "un task por ID" de FieldBeat, este archivo es el lugar correcto
// para implementarlo - la validación de env vars y el parseo de
// FIELDBEAT_TASK_IDS de abajo ya están listos para reusar.
export async function mineFieldBeatTasks() {
  if (!FIELDBEAT_API_BASE_URL || !FIELDBEAT_API_USER || !FIELDBEAT_API_PASS) {
    throw new Error("Faltan variables FIELDBEAT_API_BASE_URL, FIELDBEAT_API_USER o FIELDBEAT_API_PASS en .env");
  }

  const taskIds = String(FIELDBEAT_TASK_IDS || "")
    .split(",")
    .map(id => id.trim())
    .filter(Boolean);

  if (taskIds.length === 0) {
    throw new Error("No hay FIELDBEAT_TASK_IDS en .env. Ejemplo: FIELDBEAT_TASK_IDS=3780,3781");
  }

  throw new Error(
    "get:fieldbeat está DEPRECADO y deshabilitado (era código roto - ver comentario en src/miners/fieldbeat.js). " +
      `No se intentó ninguna llamada HTTP para los ${taskIds.length} task_id(s) en FIELDBEAT_TASK_IDS. ` +
      "Usar 'npm run get:fieldbeat:all' (o 'npm run get:all') en su lugar."
  );
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  mineFieldBeatTasks().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
