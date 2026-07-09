// Caso de uso: orquesta la normalizacion de un RAW de FieldBeat ya
// existente en R2. Unica capa que conoce tanto al dominio
// (FieldBeatNormalizer) como a la infraestructura (StorageAdapter, Queue)
// - ver process-zendesk-raw.ts para la misma explicacion de fondo, no se
// repite acá.

import { readJson, toCsv, type StorageAdapter } from "../lib/storage";
import { FieldBeatNormalizer, type FieldBeatRawPayload } from "../domain/normalizers/fieldbeat";
import type { FieldBeatProcessedReadyMessage } from "../lib/messages";

export interface ProcessFieldBeatRawDeps {
  storage: StorageAdapter;
  // Cola de salida - marts-queue en la practica (ver messages.ts), nunca
  // normalization-queue de vuelta.
  outputQueue: Queue<FieldBeatProcessedReadyMessage>;
  normalizer?: FieldBeatNormalizer;
}

export interface ProcessFieldBeatRawResult {
  tasksPath: string;
  taskEquipmentsPath: string;
  reportFieldsPath: string;
  usedPartsPath: string;
  clientsPath: string;
  equipmentDimPath: string;
  ticketBridgePath: string;
  taskCount: number;
}

// `rawPath` = "raw/fieldbeat/<runKey>/page-N.json" (ver
// FieldBeatRawReadyMessage.path). El prefijo de PROCESSED se deriva de esa
// misma clave - nunca de un timestamp nuevo - para que reprocesar el
// mismo mensaje (entrega at-least-once de Queues) escriba siempre el
// mismo prefijo en R2.
export async function processFieldBeatRaw(rawPath: string, deps: ProcessFieldBeatRawDeps): Promise<ProcessFieldBeatRawResult> {
  const { storage, outputQueue } = deps;
  const normalizer = deps.normalizer ?? new FieldBeatNormalizer();

  const payload = await readJson<FieldBeatRawPayload>(storage, rawPath);
  if (payload === null) {
    throw new Error(`No existe el RAW "${rawPath}" en el storage - nada que normalizar.`);
  }

  const tables = normalizer.normalize(payload);
  const prefix = deriveOutputPrefix(rawPath);

  const tasksPath = `${prefix}/DB_FieldBeat_Tasks.csv`;
  const taskEquipmentsPath = `${prefix}/DB_FieldBeat_Task_Equipments.csv`;
  const reportFieldsPath = `${prefix}/DB_FieldBeat_Report_Fields.csv`;
  const usedPartsPath = `${prefix}/DB_FieldBeat_Used_Parts.csv`;
  const clientsPath = `${prefix}/DIM_Clients.csv`;
  const equipmentDimPath = `${prefix}/DIM_Equipments.csv`;
  const ticketBridgePath = `${prefix}/BR_Ticket_FieldBeat_Task.csv`;

  // Cada escritura es independiente y se deja propagar sin capturar - ver
  // la misma nota critica en process-zendesk-raw.ts: un CSV que no se
  // pudo escribir nunca debe pasar en silencio, la excepcion sube hasta
  // queue-router.ts.
  await storage.put(tasksPath, toCsv(tables.tasks), "text/csv");
  await storage.put(taskEquipmentsPath, toCsv(tables.taskEquipments), "text/csv");
  await storage.put(reportFieldsPath, toCsv(tables.reportFields), "text/csv");
  await storage.put(usedPartsPath, toCsv(tables.usedParts), "text/csv");
  await storage.put(clientsPath, toCsv(tables.clients), "text/csv");
  await storage.put(equipmentDimPath, toCsv(tables.equipmentDim), "text/csv");
  await storage.put(ticketBridgePath, toCsv(tables.ticketBridge), "text/csv");

  const message: FieldBeatProcessedReadyMessage = {
    type: "FIELDBEAT_PROCESSED_READY",
    sourcePath: rawPath,
    tasksPath,
    taskEquipmentsPath,
    reportFieldsPath,
    usedPartsPath,
    clientsPath,
    equipmentDimPath,
    ticketBridgePath
  };
  await outputQueue.send(message);

  return {
    tasksPath,
    taskEquipmentsPath,
    reportFieldsPath,
    usedPartsPath,
    clientsPath,
    equipmentDimPath,
    ticketBridgePath,
    taskCount: tables.tasks.length
  };
}

function deriveOutputPrefix(rawPath: string): string {
  const match = rawPath.match(/^raw\/fieldbeat\/(.+)\.json$/);
  if (!match) {
    throw new Error(`"${rawPath}" no tiene la forma esperada "raw/fieldbeat/<runKey>/page-N.json".`);
  }
  return `processed/fieldbeat/${match[1]}`;
}
