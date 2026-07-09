// Caso de uso: orquesta la normalizacion de un RAW de Dolibarr ya
// existente en R2. Ver process-zendesk-raw.ts para la explicacion de
// fondo del patron (no se repite acá).

import { readJson, toCsv, type StorageAdapter } from "../lib/storage";
import { DolibarrNormalizer, type DolibarrRawPayload } from "../domain/normalizers/dolibarr";
import type { DolibarrProcessedReadyMessage } from "../lib/messages";

export interface ProcessDolibarrRawDeps {
  storage: StorageAdapter;
  outputQueue: Queue<DolibarrProcessedReadyMessage>;
  normalizer?: DolibarrNormalizer;
}

export interface ProcessDolibarrRawResult {
  productsPath: string;
  identitiesPath: string;
  productCount: number;
}

// `rawPath` = "raw/dolibarr/<runKey>/page-N.json" (ver
// DolibarrRawReadyMessage.path). Prefijo de PROCESSED derivado de la
// misma clave - misma razon de idempotencia que en los otros dos casos de
// uso de este pipeline.
export async function processDolibarrRaw(rawPath: string, deps: ProcessDolibarrRawDeps): Promise<ProcessDolibarrRawResult> {
  const { storage, outputQueue } = deps;
  const normalizer = deps.normalizer ?? new DolibarrNormalizer();

  const payload = await readJson<DolibarrRawPayload>(storage, rawPath);
  if (payload === null) {
    throw new Error(`No existe el RAW "${rawPath}" en el storage - nada que normalizar.`);
  }

  const tables = normalizer.normalize(payload);
  const prefix = deriveOutputPrefix(rawPath);

  const productsPath = `${prefix}/DB_Dolibarr_Products.csv`;
  const identitiesPath = `${prefix}/DIM_Dolibarr_Product_Identity_Map.csv`;

  await storage.put(productsPath, toCsv(tables.products), "text/csv");
  await storage.put(identitiesPath, toCsv(tables.identities), "text/csv");

  const message: DolibarrProcessedReadyMessage = {
    type: "DOLIBARR_PROCESSED_READY",
    sourcePath: rawPath,
    productsPath,
    identitiesPath
  };
  await outputQueue.send(message);

  return { productsPath, identitiesPath, productCount: tables.products.length };
}

function deriveOutputPrefix(rawPath: string): string {
  const match = rawPath.match(/^raw\/dolibarr\/(.+)\.json$/);
  if (!match) {
    throw new Error(`"${rawPath}" no tiene la forma esperada "raw/dolibarr/<runKey>/page-N.json".`);
  }
  return `processed/dolibarr/${match[1]}`;
}
