// Constructor MARTS #1 - Used_Parts_Dolibarr_Match: le pasa cada repuesto
// usado de FieldBeat por PartIdentityResolver (ver
// src/domain/resolvers/part-identity-resolver.ts) y devuelve una fila por
// repuesto con el resultado de la resolucion. Equivalente puro de
// build-used-parts-dolibarr-match.js (pipeline local), sin los reportes
// laterales (no-match/ambiguous/review-queue) - esos son reportes
// operativos, no una tabla MARTS, y quedan fuera del alcance de este
// modulo a proposito.
//
// PURO: no importa nada de R2/Queues/Cloudflare, no hace I/O. El resolver
// ya llega construido (con sus indices ya armados) - este modulo no sabe
// ni le importa como se armo el catalogo Dolibarr ni los alias.

import type { PartIdentityMatch, PartIdentityResolver } from "../resolvers/part-identity-resolver";

// Forma de una fila de DB_FieldBeat_Used_Parts.csv (PROCESSED, ver
// src/domain/normalizers/fieldbeat.ts) - solo las columnas que este
// cruce necesita, tal cual salen de readCsv (todas string). Extiende
// Record<string, string> para poder viajar directo desde readCsv() sin
// cast intermedio, y para calzar con groupBy() (ver domain/marts/lib.ts).
export interface UsedPartSourceRow extends Record<string, string> {
  used_part_id: string;
  fieldbeat_task_id: string;
  zendesk_ticket_id: string;
  part_name: string;
  part_number: string;
}

export interface UsedPartDolibarrMatchRow extends Record<string, unknown>, PartIdentityMatch {
  used_part_id: string;
  fieldbeat_task_id: string;
  zendesk_ticket_id: string;
  part_name: string;
}

// O(n): un resolve() por repuesto usado. Cada resolve() es O(1)
// amortizado (los indices del catalogo ya se construyeron una sola vez al
// crear `resolver`, ver PartIdentityResolver) - nunca se vuelve a recorrer
// el catalogo Dolibarr ni los alias por fila.
export function buildUsedPartsDolibarrMatch(
  usedParts: UsedPartSourceRow[],
  resolver: PartIdentityResolver
): UsedPartDolibarrMatchRow[] {
  return usedParts.map(part => {
    const match = resolver.resolve(part.part_number);

    return {
      used_part_id: part.used_part_id || "",
      fieldbeat_task_id: part.fieldbeat_task_id || "",
      zendesk_ticket_id: part.zendesk_ticket_id || "",
      part_name: part.part_name || "",
      ...match
    };
  });
}
