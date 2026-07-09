// Nucleo de dominio - normalizacion de Dolibarr RAW a tablas tipadas.
// Transplante literal de src/normalizers/dolibarr-normalizer.js (pipeline
// local), incluyendo normalizeIdentifier() de
// src/resolvers/part-identity-resolver.js (tambien pura, se re-implementa
// acá en vez de importarla - ese modulo vive del lado del pipeline Node y
// no es parte de este proyecto edge).
//
// PURO a proposito: no importa nada de R2/Queues/Cloudflare, no hace I/O.
// Ver src/use-cases/process-dolibarr-raw.ts para quien lee el RAW y
// escribe el PROCESSED.

// ---------------------------------------------------------------------
// Entrada: forma cruda de un producto de Dolibarr (API v2 REST)
// ---------------------------------------------------------------------

export interface DolibarrRawProduct {
  id?: string | number;
  ref?: string;
  barcode?: string;
  label?: string;
  status?: string | number;
  status_buy?: string | number;
  price?: string | number;
  cost_price?: string | number;
  date_creation?: string;
  date_modification?: string;
}

// El endpoint de productos de Dolibarr devuelve un array desnudo (ver
// src/workers/dolibarr-miner.ts) - sin envoltorio como Zendesk/FieldBeat.
export type DolibarrRawPayload = DolibarrRawProduct[];

// ---------------------------------------------------------------------
// Salida: filas tipadas para las 2 tablas que produce este modulo -
// mismos nombres que en el pipeline local (DB_Dolibarr_Products,
// DIM_Dolibarr_Product_Identity_Map).
// ---------------------------------------------------------------------

export interface DolibarrProductRow extends Record<string, unknown> {
  dolibarr_product_id: string;
  ref: string;
  barcode: string;
  label: string;
  status: string | number;
  status_buy: string | number;
  price: string | number;
  cost_price: string | number;
  date_creation: string;
  date_modification: string;
  extracted_at: string;
}

export type DolibarrIdentityType = "REF" | "BARCODE" | "ID";

export interface DolibarrIdentityRow extends Record<string, unknown> {
  identity_id: string;
  dolibarr_product_id: string;
  identity_type: DolibarrIdentityType;
  identity_value: string;
  identity_value_normalized: string;
  dolibarr_ref: string;
  dolibarr_barcode: string;
  dolibarr_label: string;
  extracted_at: string;
}

export interface DolibarrNormalizedTables {
  products: DolibarrProductRow[];
  identities: DolibarrIdentityRow[];
}

// ---------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------

function makeKey(...parts: unknown[]): string {
  return parts.map(part => String(part ?? "").trim()).join("|");
}

// Copia exacta de normalizeIdentifier() en
// src/resolvers/part-identity-resolver.js (pipeline local): quita
// diacriticos, mayusculiza, y se queda solo con A-Z0-9. Es la base de la
// resolucion de identidad de repuestos en MARTS (Fase 3C) - debe producir
// exactamente el mismo valor de un lado y del otro para que un match
// hecho en el pipeline local siga siendo valido en el edge.
export function normalizeIdentifier(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .trim();
}

function dedupeByKey<T extends Record<string, unknown>>(rows: T[], keyField: keyof T): T[] {
  const byKey = new Map<unknown, T>();
  for (const row of rows) {
    const key = row[keyField];
    if (!key) continue;
    byKey.set(key, row);
  }
  return Array.from(byKey.values());
}

// Exportada para que el miner (src/workers/dolibarr-miner.ts) pueda
// contar productos de una pagina para logging sin duplicar la logica de
// "el payload es un array o no es nada valido".
export function extractDolibarrProducts(payload: DolibarrRawPayload): DolibarrRawProduct[] {
  return Array.isArray(payload) ? payload : [];
}

export class DolibarrNormalizer {
  normalize(payload: DolibarrRawPayload, extractedAt: string = new Date().toISOString()): DolibarrNormalizedTables {
    const products = extractDolibarrProducts(payload);

    const productRows: DolibarrProductRow[] = [];
    const identityRows: DolibarrIdentityRow[] = [];

    for (const product of products) {
      const productId = String(product.id ?? "").trim();
      if (!productId) continue;

      const ref = String(product.ref || "").trim();
      const barcode = String(product.barcode || "").trim();
      const label = product.label || "";

      productRows.push({
        dolibarr_product_id: productId,
        ref,
        barcode,
        label,
        status: product.status ?? "",
        status_buy: product.status_buy ?? "",
        price: product.price ?? "",
        cost_price: product.cost_price ?? "",
        date_creation: product.date_creation || "",
        date_modification: product.date_modification || "",
        extracted_at: extractedAt
      });

      if (ref) {
        identityRows.push({
          identity_id: makeKey(productId, "REF", ref),
          dolibarr_product_id: productId,
          identity_type: "REF",
          identity_value: ref,
          identity_value_normalized: normalizeIdentifier(ref),
          dolibarr_ref: ref,
          dolibarr_barcode: barcode,
          dolibarr_label: label,
          extracted_at: extractedAt
        });
      }

      if (barcode) {
        identityRows.push({
          identity_id: makeKey(productId, "BARCODE", barcode),
          dolibarr_product_id: productId,
          identity_type: "BARCODE",
          identity_value: barcode,
          identity_value_normalized: normalizeIdentifier(barcode),
          dolibarr_ref: ref,
          dolibarr_barcode: barcode,
          dolibarr_label: label,
          extracted_at: extractedAt
        });
      }

      identityRows.push({
        identity_id: makeKey(productId, "ID", productId),
        dolibarr_product_id: productId,
        identity_type: "ID",
        identity_value: productId,
        identity_value_normalized: normalizeIdentifier(productId),
        dolibarr_ref: ref,
        dolibarr_barcode: barcode,
        dolibarr_label: label,
        extracted_at: extractedAt
      });
    }

    return {
      products: dedupeByKey(productRows, "dolibarr_product_id"),
      identities: dedupeByKey(identityRows, "identity_id")
    };
  }
}
