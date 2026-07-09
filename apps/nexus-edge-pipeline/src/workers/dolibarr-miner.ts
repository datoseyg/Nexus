// Ingestor de Dolibarr - logica de negocio de la Fase 3B, disparada por
// Cron Trigger. Equivalente edge de src/miners/dolibarr.js (pipeline
// local) - mismo LIMIT/MAX_PAGES, misma condicion de corte
// (`products.length < LIMIT`), mismo header de autenticacion.
//
// Dolibarr NO usa Basic Auth - el header es `DOLAPIKEY: <token>` plano,
// asi que no aplica btoa() acá (a diferencia de Zendesk/FieldBeat).

import { getJson } from "../lib/http";
import { saveJson, type StorageAdapter } from "../lib/storage";
import { extractDolibarrProducts, type DolibarrRawPayload } from "../domain/normalizers/dolibarr";
import type { NormalizationQueueMessage } from "../lib/messages";

export interface DolibarrMinerEnv {
  DOLIBARR_URL: string;
  DOLIBARR_TOKEN: string;
  NORMALIZATION_QUEUE: Queue<NormalizationQueueMessage>;
}

// Mismos valores que LIMIT/MAX_PAGES en dolibarr.js - Dolibarr no tiene
// cursor (a diferencia de FieldBeat), solo `page` incremental con corte
// por "la ultima pagina trajo menos que el limite", así que el mismo
// limite que el script local sigue siendo razonable para una invocacion
// de Worker.
const PAGE_LIMIT = 100;
const MAX_PAGES_PER_RUN = 50;

export interface DolibarrMinerResult {
  pagesFetched: number;
  productsFetched: number;
}

// Idempotencia: mismo criterio que zendesk-miner.ts/fieldbeat-miner.ts -
// clave de R2 derivada de `scheduledAt`, nunca de Date.now().
// Dolibarr pagina desde 0 (no desde 1) - igual que el script local, se
// preserva esa convencion en vez de forzar una consistencia artificial
// entre dominios.
export async function mineDolibarrProducts(
  env: DolibarrMinerEnv,
  storage: StorageAdapter,
  scheduledAt: Date
): Promise<DolibarrMinerResult> {
  if (!env.DOLIBARR_URL || !env.DOLIBARR_TOKEN) {
    throw new Error(
      "Faltan bindings DOLIBARR_URL/DOLIBARR_TOKEN - la URL va en [vars] de wrangler.toml, el TOKEN se " +
      "configura con `wrangler secret put`."
    );
  }

  const runKey = scheduledAt.toISOString().replace(/[:.]/g, "-");

  let page = 0;
  let pagesFetched = 0;
  let productsFetched = 0;

  while (page < MAX_PAGES_PER_RUN) {
    const url = `${env.DOLIBARR_URL}/api/index.php/products?limit=${PAGE_LIMIT}&page=${page}`;
    const data = await getJson<DolibarrRawPayload>(url, {
      headers: { DOLAPIKEY: env.DOLIBARR_TOKEN }
    });

    const products = extractDolibarrProducts(data);
    productsFetched += products.length;
    pagesFetched += 1;

    const path = `raw/dolibarr/${runKey}/page-${page}.json`;
    await saveJson(storage, path, data);

    const message: NormalizationQueueMessage = { type: "DOLIBARR_RAW_READY", path, page };
    await env.NORMALIZATION_QUEUE.send(message);

    if (products.length < PAGE_LIMIT) break;
    page += 1;
  }

  return { pagesFetched, productsFetched };
}
