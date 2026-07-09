// Capa anticorrupcion - resuelve la identidad de un repuesto de FieldBeat
// (un string suelto tecleado por un tecnico) contra el catalogo de
// productos de Dolibarr. Transplante de src/resolvers/part-identity-resolver.js
// (pipeline local), MISMA cascada de reglas y MISMA semantica de resultado
// en cada nivel - no se relaja ni se reordena ninguna regla de negocio.
//
// PURO a proposito: no importa nada de R2/Queues/Cloudflare, no hace I/O.
// Recibe estructuras en memoria (el catalogo Dolibarr y los alias
// manuales) y devuelve estructuras en memoria - quien lee el PROCESSED y
// escribe el MARTS es src/use-cases/build-marts.ts, no este archivo.
//
// Cascada de resolucion (estrictamente en este orden, se detiene en el
// primer nivel que produzca candidatos):
//   1. Alias manual exacto (decision humana, pisa todo lo demas)
//   2. Valor placeholder ("sin numero", "n/a", ...) -> PLACEHOLDER_VALUE
//   3. REF exacto -> BARCODE exacto -> ID exacto
//   4. REF normalizado -> BARCODE normalizado
//   5. REF difuso (substring en cualquier direccion, solo como ultimo recurso)

const MIN_LIKE_LENGTH = 4;

export function normalizeIdentifier(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .trim();
}

// Valores que los tecnicos usan historicamente para decir "no hay dato",
// no un codigo real. Se comparan normalizados (mismo normalizeIdentifier
// de arriba) para cubrir variantes de tildes/espacios/mayusculas sin hacer
// fuzzy matching.
const PLACEHOLDER_LITERALS = [
  "sin numero", "sin número", "sin nro", "sin n°", "s/n", "sn",
  "n/a", "na", "no aplica", "sin serie", "sin codigo", "sin código",
  "no tiene", "pendiente", "no corresponde", "sin información", "sin informacion",
  "nc", "n/c", "n.c.", "no consume", "sin consumo", "sin repuesto", "sin repuestos"
];

const PLACEHOLDER_NORMALIZED_SET = new Set(PLACEHOLDER_LITERALS.map(normalizeIdentifier));

// Un valor que no deja ningun caracter alfanumerico tras normalizar
// ("---", ".......", espacios) tampoco es un identificador real.
function isPlaceholderValue(normalizedValue: string): boolean {
  if (!normalizedValue) return true;
  return PLACEHOLDER_NORMALIZED_SET.has(normalizedValue);
}

// ---------------------------------------------------------------------
// Contratos de entrada/salida
// ---------------------------------------------------------------------

export type DolibarrIdentityType = "REF" | "BARCODE" | "ID" | string;

// Forma de una fila de DIM_Dolibarr_Product_Identity_Map.csv (PROCESSED,
// ver src/domain/normalizers/dolibarr.ts) tal cual sale de readCsv - todos
// los campos son string porque un CSV no tiene tipos propios. Extiende
// Record<string, string> (no unknown) para poder viajar directo desde
// readCsv() sin un cast intermedio - ver src/use-cases/build-marts.ts.
export interface DolibarrIdentityEntry extends Record<string, string> {
  dolibarr_product_id: string;
  identity_type: DolibarrIdentityType;
  identity_value: string;
  identity_value_normalized: string;
  dolibarr_ref: string;
  dolibarr_barcode: string;
  dolibarr_label: string;
}

export type PartAliasType = "NORMALIZED" | "RAW" | string;

// Forma de una fila del diccionario de alias manuales
// (config/part_identity_aliases.csv) - dictado a mano por un humano que ya
// decidio a que producto corresponde un literal que la cascada automatica
// no puede resolver.
export interface PartIdentityAliasEntry extends Record<string, string> {
  alias_type: PartAliasType;
  alias_value: string;
  dolibarr_product_id: string;
  dolibarr_ref: string;
}

export type PartMatchMethod =
  | "MANUAL_ALIAS_EXACT"
  | "PLACEHOLDER_REJECTED"
  | "REF_EXACT"
  | "BARCODE_EXACT"
  | "ID_EXACT"
  | "REF_NORMALIZED_EXACT"
  | "BARCODE_NORMALIZED_EXACT"
  | "REF_LIKE"
  | "NONE";

export type PartMatchStatus = "MATCHED" | "NO_MATCH" | "AMBIGUOUS_MATCH" | "PLACEHOLDER_VALUE";

export interface PartIdentityMatch {
  raw_part_identifier: string;
  normalized_part_identifier: string;
  dolibarr_product_id: string;
  dolibarr_ref: string;
  dolibarr_barcode: string;
  dolibarr_label: string;
  match_method: PartMatchMethod;
  match_confidence: number;
  match_status: PartMatchStatus;
  needs_manual_review: boolean;
  candidate_dolibarr_product_ids: string;
}

interface ProductEnrichment {
  ref: string;
  barcode: string;
  label: string;
}

// Alias indexado con su posicion original en el CSV - necesario para
// preservar el desempate por orden de archivo (ver resolveManualAlias).
interface IndexedAlias {
  alias: PartIdentityAliasEntry;
  index: number;
}

function pushCandidate(map: Map<string, DolibarrIdentityEntry[]>, key: string, entry: DolibarrIdentityEntry): void {
  if (!key) return;
  const bucket = map.get(key);
  if (bucket) bucket.push(entry);
  else map.set(key, [entry]);
}

function dedupeByProduct(rows: DolibarrIdentityEntry[]): DolibarrIdentityEntry[] {
  const byProduct = new Map<string, DolibarrIdentityEntry>();
  for (const row of rows) {
    if (!byProduct.has(row.dolibarr_product_id)) byProduct.set(row.dolibarr_product_id, row);
  }
  return Array.from(byProduct.values());
}

// Resolver de identidad de repuestos - clase con estado inmutable
// construido UNA vez a partir del catalogo Dolibarr y los alias
// manuales. `resolve()` se llama despues una vez por cada repuesto usado
// de FieldBeat (ver src/domain/marts/used-parts-match.ts).
//
// Decision de complejidad algoritmica (nucleo de esta clase): el script
// heredado (part-identity-resolver.js) recalculaba `identityMap.filter(...)`
// desde cero en CADA llamada a resolvePartIdentity() - O(tamaño del
// catalogo) por repuesto, O(catalogo * repuestos) en total. Eso es
// aceptable con cientos de filas en Node local, pero no escala dentro del
// limite de 128MB/CPU de un Worker cuando el catalogo y los repuestos
// usados crecen. Este resolver construye 5 indices Map<string, entry[]>
// UNA sola vez en el constructor (una pasada O(catalogo)), y cada
// resolve() despues consulta esos indices en O(1) amortizado. El unico
// nivel que sigue sin ser O(1) es REF_LIKE (comparacion de substring en
// ambas direcciones) porque es intrinsecamente difuso - pero solo se
// alcanza cuando los 5 niveles exactos de arriba fallaron, así que es el
// camino frio, no el caliente.
export class PartIdentityResolver {
  private readonly productEnrichment = new Map<string, ProductEnrichment>();
  private readonly refExactIndex = new Map<string, DolibarrIdentityEntry[]>();
  private readonly barcodeExactIndex = new Map<string, DolibarrIdentityEntry[]>();
  private readonly idExactIndex = new Map<string, DolibarrIdentityEntry[]>();
  private readonly refNormalizedIndex = new Map<string, DolibarrIdentityEntry[]>();
  private readonly barcodeNormalizedIndex = new Map<string, DolibarrIdentityEntry[]>();
  // Solo entradas REF con longitud normalizada suficiente - pre-filtradas
  // acá para que el tramo difuso de resolve() nunca tenga que volver a
  // evaluar entradas que jamas podrian calificar (MIN_LIKE_LENGTH).
  private readonly refLikeCandidates: DolibarrIdentityEntry[] = [];
  private readonly aliasByNormalized = new Map<string, IndexedAlias>();
  private readonly aliasByRaw = new Map<string, IndexedAlias>();

  constructor(identityMap: DolibarrIdentityEntry[], aliasRows: PartIdentityAliasEntry[] = []) {
    for (const entry of identityMap) {
      if (!this.productEnrichment.has(entry.dolibarr_product_id)) {
        this.productEnrichment.set(entry.dolibarr_product_id, {
          ref: entry.dolibarr_ref || "",
          barcode: entry.dolibarr_barcode || "",
          label: entry.dolibarr_label || ""
        });
      }

      const value = String(entry.identity_value ?? "").trim();
      const normalized = entry.identity_value_normalized || "";

      if (entry.identity_type === "REF") {
        pushCandidate(this.refExactIndex, value, entry);
        pushCandidate(this.refNormalizedIndex, normalized, entry);
        if (normalized.length >= MIN_LIKE_LENGTH) this.refLikeCandidates.push(entry);
      } else if (entry.identity_type === "BARCODE") {
        pushCandidate(this.barcodeExactIndex, value, entry);
        pushCandidate(this.barcodeNormalizedIndex, normalized, entry);
      } else if (entry.identity_type === "ID") {
        pushCandidate(this.idExactIndex, value, entry);
      }
    }

    // Indice de alias - primera ocurrencia en el CSV gana por clave
    // (mismo criterio que el `.find()` del script heredado). Se conserva
    // el indice original de cada alias para poder desempatar
    // correctamente en resolveManualAlias cuando un mismo raw calza tanto
    // por alias RAW como por alias NORMALIZED.
    aliasRows.forEach((alias, index) => {
      const aliasValue = String(alias.alias_value || "").trim();
      if (!aliasValue) return;

      const aliasType = String(alias.alias_type || "").trim().toUpperCase();

      if (aliasType === "NORMALIZED") {
        const key = normalizeIdentifier(aliasValue);
        if (!this.aliasByNormalized.has(key)) this.aliasByNormalized.set(key, { alias, index });
      } else {
        if (!this.aliasByRaw.has(aliasValue)) this.aliasByRaw.set(aliasValue, { alias, index });
      }
    });
  }

  resolve(rawValue: unknown): PartIdentityMatch {
    const raw = String(rawValue ?? "").trim();
    const normalizedRaw = normalizeIdentifier(raw);

    const aliasResult = this.resolveManualAlias(raw, normalizedRaw);
    if (aliasResult) return aliasResult;

    // El placeholder se evalua antes de intentar cualquier match
    // automatico (incluyendo REF_EXACT), no solo antes de REF_LIKE: un
    // valor como "sin numero" no debe intentar matchear contra Dolibarr
    // en absoluto. Un raw vacio tambien cae aca (normalizedRaw === "").
    if (isPlaceholderValue(normalizedRaw)) {
      return {
        raw_part_identifier: raw,
        normalized_part_identifier: normalizedRaw,
        dolibarr_product_id: "",
        dolibarr_ref: "",
        dolibarr_barcode: "",
        dolibarr_label: "",
        match_method: "PLACEHOLDER_REJECTED",
        match_confidence: 0,
        match_status: "PLACEHOLDER_VALUE",
        needs_manual_review: true,
        candidate_dolibarr_product_ids: ""
      };
    }

    const refExact = this.refExactIndex.get(raw);
    if (refExact) return this.buildResult(raw, normalizedRaw, "REF_EXACT", 1, refExact);

    const barcodeExact = this.barcodeExactIndex.get(raw);
    if (barcodeExact) return this.buildResult(raw, normalizedRaw, "BARCODE_EXACT", 1, barcodeExact);

    // ID_EXACT por diseño solo se evalua si REF/BARCODE no encontraron
    // nada - así nunca compite con ellos, igual que el script heredado.
    const idExact = this.idExactIndex.get(raw);
    if (idExact) return this.buildResult(raw, normalizedRaw, "ID_EXACT", 0.9, idExact);

    const refNormalized = this.refNormalizedIndex.get(normalizedRaw);
    if (refNormalized) return this.buildResult(raw, normalizedRaw, "REF_NORMALIZED_EXACT", 0.85, refNormalized);

    const barcodeNormalized = this.barcodeNormalizedIndex.get(normalizedRaw);
    if (barcodeNormalized) return this.buildResult(raw, normalizedRaw, "BARCODE_NORMALIZED_EXACT", 0.85, barcodeNormalized);

    if (normalizedRaw.length >= MIN_LIKE_LENGTH) {
      const refLike = this.refLikeCandidates.filter(entry => {
        const value = entry.identity_value_normalized || "";
        return normalizedRaw.includes(value) || value.includes(normalizedRaw);
      });

      if (refLike.length > 0) return this.buildResult(raw, normalizedRaw, "REF_LIKE", 0.5, refLike);
    }

    return this.buildResult(raw, normalizedRaw, "NONE", 0, []);
  }

  // Un mismo raw puede calzar simultaneamente por alias RAW (comparacion
  // exacta) y por alias NORMALIZED (comparacion normalizada) si ambos
  // fueron cargados al diccionario - en ese caso el script heredado
  // (recorrido lineal unico) se queda con el que aparece primero en el
  // archivo, sin importar su tipo. Se replica exactamente comparando
  // `index` entre los dos candidatos en vez de asumir que un tipo siempre
  // prioriza sobre el otro.
  private resolveManualAlias(raw: string, normalizedRaw: string): PartIdentityMatch | null {
    const byNormalized = this.aliasByNormalized.get(normalizedRaw);
    const byRaw = this.aliasByRaw.get(raw);

    const winner = byNormalized && byRaw
      ? (byNormalized.index <= byRaw.index ? byNormalized : byRaw)
      : (byNormalized ?? byRaw);

    if (!winner) return null;

    const alias = winner.alias;
    const productId = String(alias.dolibarr_product_id || "").trim();
    const enrichment = this.productEnrichment.get(productId);

    return {
      raw_part_identifier: raw,
      normalized_part_identifier: normalizedRaw,
      dolibarr_product_id: productId,
      dolibarr_ref: alias.dolibarr_ref || enrichment?.ref || "",
      dolibarr_barcode: enrichment?.barcode || "",
      dolibarr_label: enrichment?.label || "",
      match_method: "MANUAL_ALIAS_EXACT",
      match_confidence: 1,
      match_status: "MATCHED",
      needs_manual_review: false,
      candidate_dolibarr_product_ids: ""
    };
  }

  private buildResult(
    rawValue: string,
    normalizedValue: string,
    method: PartMatchMethod,
    confidence: number,
    candidateRows: DolibarrIdentityEntry[]
  ): PartIdentityMatch {
    const candidates = dedupeByProduct(candidateRows);

    if (candidates.length === 0) {
      return {
        raw_part_identifier: rawValue,
        normalized_part_identifier: normalizedValue,
        dolibarr_product_id: "",
        dolibarr_ref: "",
        dolibarr_barcode: "",
        dolibarr_label: "",
        match_method: "NONE",
        match_confidence: 0,
        match_status: "NO_MATCH",
        needs_manual_review: true,
        candidate_dolibarr_product_ids: ""
      };
    }

    if (candidates.length > 1) {
      return {
        raw_part_identifier: rawValue,
        normalized_part_identifier: normalizedValue,
        dolibarr_product_id: "",
        dolibarr_ref: "",
        dolibarr_barcode: "",
        dolibarr_label: "",
        match_method: method,
        match_confidence: confidence,
        match_status: "AMBIGUOUS_MATCH",
        needs_manual_review: true,
        candidate_dolibarr_product_ids: candidates.map(c => c.dolibarr_product_id).join("|")
      };
    }

    const winner = candidates[0];

    return {
      raw_part_identifier: rawValue,
      normalized_part_identifier: normalizedValue,
      dolibarr_product_id: winner.dolibarr_product_id,
      dolibarr_ref: winner.dolibarr_ref || "",
      dolibarr_barcode: winner.dolibarr_barcode || "",
      dolibarr_label: winner.dolibarr_label || "",
      match_method: method,
      match_confidence: confidence,
      match_status: "MATCHED",
      needs_manual_review: method === "REF_LIKE",
      candidate_dolibarr_product_ids: ""
    };
  }
}
