// Caso de uso: orquesta la Fase 5 del blueprint (capa GOLD) - ultimo
// escalon del medallon. Es la UNICA capa que conoce tanto al dominio (los
// 5 constructores de src/domain/gold/*.ts) como a la infraestructura
// (StorageAdapter + D1Loader) - ninguno de los dos se conoce entre si,
// misma separacion que build-marts.ts para MARTS. Quien invoca esto es
// src/workers/queue-router.ts, al recibir MARTS_PROCESSED_READY en
// gold-queue.
//
// Patron Fan-In (igual que build-marts.ts, ver ese archivo para el
// razonamiento completo): este caso de uso NO confia en los paths que
// trae el mensaje que lo disparo - siempre vuelve a descubrir el runKey
// de MARTS mas reciente con storage.list(), para que un mensaje
// duplicado o fuera de orden (Cloudflare Queues entrega al menos una vez)
// nunca reconstruya GOLD contra un runKey viejo. Si el runKey mas
// reciente de MARTS no tiene las tablas esenciales completas, aborta en
// silencio (`built: false`) - no debería pasar en la practica (GOLD solo
// se dispara DESPUES de que build-marts.ts ya escribio las 3 tablas y
// encolo el mensaje), pero mantiene el mismo contrato defensivo que el
// resto del pipeline en vez de asumir que "el evento llego" implica "los
// datos estan".

import { readCsv, toCsv, type StorageAdapter } from "../lib/storage";
import { findLatestRunKey, makeRunKey } from "../lib/latest-run";
import { D1Loader } from "../lib/d1-loader";
import { buildOperationalDashboard } from "../domain/gold/operational-dashboard";
import { buildDataQualityReport } from "../domain/gold/data-quality-report";
import { buildClientServiceProfile } from "../domain/gold/client-service-profile";
import { buildEquipmentServiceProfile } from "../domain/gold/equipment-service-profile";
import { buildUsedPartsAnalysis } from "../domain/gold/used-parts-analysis";
import type { TicketFieldBeatDolibarrMartRow, UsedPartsMatchMartRow } from "../domain/gold/lib";

export interface BuildGoldDeps {
  storage: StorageAdapter;
  db: D1Database;
}

export interface BuildGoldOutput {
  table: string;
  csvPath: string;
  rowCount: number;
}

export interface BuildGoldResult {
  built: boolean;
  // Motivo de aborto legible para logging (ver queue-router.ts) - nunca se
  // usa para decidir logica, solo para observabilidad.
  reason?: string;
  martsRunKey?: string;
  goldRunKey?: string;
  outputs?: BuildGoldOutput[];
}

const MARTS_PREFIX = "marts/";
const GOLD_PREFIX = "gold/";

// MARTS #3 (ticket-centrico, con calidad de match agregada por ticket) y
// MARTS #1 (catalogo global de repuestos) - los unicos dos MARTS que los
// 5 constructores GOLD portados necesitan. MARTS #2
// (Ticket_FieldBeat_Operational_View, sin la agregacion de repuestos) es
// un insumo intermedio de build-marts.ts, no algo que GOLD necesite leer
// de vuelta.
const TICKET_MART_FILE = "Ticket_FieldBeat_Dolibarr_Operational_View.csv";
const USED_PARTS_MART_FILE = "Used_Parts_Dolibarr_Match.csv";

// Nombre de tabla GOLD = mismo nombre base que el CSV de respaldo en R2
// (ver GOLD_DATA_CONTRACT.md) - un unico nombre para las 3 superficies
// (archivo R2, tabla D1, documentacion) evita que alguien tenga que
// mantener un mapeo mental entre nombres distintos. Quien declare el
// esquema D1 (migracion `wrangler d1 migrations`, fuera del alcance de
// este caso de uso) debe usar EXACTAMENTE estos mismos nombres, citados
// igual (ver quoteIdent en d1-loader.ts).
const OPERATIONAL_DASHBOARD_TABLE = "GOLD_Operational_Dashboard";
const DATA_QUALITY_REPORT_TABLE = "GOLD_Data_Quality_Report";
const CLIENT_SERVICE_PROFILE_TABLE = "GOLD_Client_Service_Profile";
const EQUIPMENT_SERVICE_PROFILE_TABLE = "GOLD_Equipment_Service_Profile";
const USED_PARTS_ANALYSIS_TABLE = "GOLD_Used_Parts_Analysis";

export async function buildGold(deps: BuildGoldDeps): Promise<BuildGoldResult> {
  const { storage, db } = deps;

  const martsKeys = await storage.list(MARTS_PREFIX);
  const martsRunKey = findLatestRunKey(martsKeys, MARTS_PREFIX);
  if (!martsRunKey) return { built: false, reason: "Sin MARTS todavia." };

  const runPrefix = `${MARTS_PREFIX}${martsRunKey}/`;
  const runKeys = await storage.list(runPrefix);

  const ticketMartPath = `${runPrefix}${TICKET_MART_FILE}`;
  const usedPartsMartPath = `${runPrefix}${USED_PARTS_MART_FILE}`;

  const hasTicketMart = runKeys.includes(ticketMartPath);
  const hasUsedPartsMart = runKeys.includes(usedPartsMartPath);

  if (!hasTicketMart || !hasUsedPartsMart) {
    return { built: false, reason: `Faltan tablas MARTS esenciales en el runKey mas reciente ("${martsRunKey}").` };
  }

  const [ticketRows, usedPartRows] = await Promise.all([
    readCsv(storage, ticketMartPath) as Promise<TicketFieldBeatDolibarrMartRow[]>,
    readCsv(storage, usedPartsMartPath) as Promise<UsedPartsMatchMartRow[]>
  ]);

  const goldTables: Array<{ table: string; rows: Array<Record<string, unknown>> }> = [
    { table: OPERATIONAL_DASHBOARD_TABLE, rows: buildOperationalDashboard(ticketRows) },
    { table: DATA_QUALITY_REPORT_TABLE, rows: buildDataQualityReport(ticketRows) },
    { table: CLIENT_SERVICE_PROFILE_TABLE, rows: buildClientServiceProfile(ticketRows) },
    { table: EQUIPMENT_SERVICE_PROFILE_TABLE, rows: buildEquipmentServiceProfile(ticketRows) },
    { table: USED_PARTS_ANALYSIS_TABLE, rows: buildUsedPartsAnalysis(usedPartRows) }
  ];

  // GOLD, igual que RAW/PROCESSED/MARTS, es inmutable y particionado por
  // runKey en R2 (respaldo auditable - ver GOLD_DATA_CONTRACT.md sobre
  // por que cada tabla GOLD necesita poder reconstruirse a partir de un
  // snapshot fijo). D1 en cambio es la superficie "en vivo": D1Loader
  // reemplaza el contenido de cada tabla en el mismo binding WAREHOUSE,
  // sin versionar por runKey - un consumidor BI conectado a D1 siempre ve
  // el ultimo build, nunca tiene que saber que runKey es el vigente.
  const goldRunKey = makeRunKey();
  const loader = new D1Loader(db);

  const outputs = await Promise.all(
    goldTables.map(async ({ table, rows }): Promise<BuildGoldOutput> => {
      const csvPath = `${GOLD_PREFIX}${goldRunKey}/${table}.csv`;

      await Promise.all([storage.put(csvPath, toCsv(rows), "text/csv"), loader.replaceAll(table, rows)]);

      return { table, csvPath, rowCount: rows.length };
    })
  );

  return { built: true, martsRunKey, goldRunKey, outputs };
}
