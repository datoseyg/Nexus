const MIN_LIKE_LENGTH = 4;

export function normalizeIdentifier(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .trim();
}

// Valores que no representan un identificador real.
//
// Importante:
// - Algunos significan “no se utilizó repuesto”.
// - Otros solo significan “no se informó el identificador”.
// Esta lista únicamente los clasifica como PLACEHOLDER_VALUE.
// La distinción NO_PART_USED debe realizarse posteriormente con la regla
// semántica correspondiente y considerando cantidad/evidencia contradictoria.
export const PLACEHOLDER_LITERALS = [
  // Vacío
  "",

  // Abreviaturas comunes
  "n/a",
  "na",
  "n.c.",
  "n/c",
  "nc",
  "s/d",
  "sd",

  // Ausencia explícita
  "no",
  "ninguno",
  "ninguna",
  "ningún",
  "ningun",
  "nada",

  // No existe o no se dispone
  "no hay",
  "no existe",
  "no existen",
  "no tiene",
  "no tienen",
  "no posee",
  "no poseen",
  "no presenta",
  "no presentan",
  "no registra",
  "no registrado",
  "no registrada",
  "no disponible",

  // No aplica o no corresponde
  "no aplica",
  "no aplicable",
  "no corresponde",
  "no correspondía",
  "no correspondia",
  "no procede",
  "no requerido",
  "no requerida",
  "no requiere",
  "no se requiere",

  // Ausencia explícita de repuesto
  "sin repuesto",
  "sin repuestos",
  "sin uso de repuesto",
  "sin uso de repuestos",
  "sin utilizar repuesto",
  "sin utilizar repuestos",
  "no utilizó repuesto",
  "no utilizo repuesto",
  "no utilizó repuestos",
  "no utilizo repuestos",
  "no se utilizó repuesto",
  "no se utilizo repuesto",
  "no se utilizaron repuestos",
  "no se usó repuesto",
  "no se uso repuesto",
  "no se usaron repuestos",
  "repuesto no utilizado",
  "repuestos no utilizados",

  // Ausencia de consumo
  "no consume",
  "no consumió",
  "no consumio",
  "no se consumió",
  "no se consumio",
  "sin consumo",
  "sin consumos",

  // Ausencia de materiales o insumos
  "sin material",
  "sin materiales",
  "sin insumo",
  "sin insumos",
  "no se usaron materiales",
  "no se utilizaron materiales",
  "no se usaron insumos",
  "no se utilizaron insumos",

  // Identificador no informado
  "sin número",
  "sin numero",
  "sin nro",
  "sin n°",
  "sin num",
  "s/n",
  "sn",
  "sin serie",
  "sin número de serie",
  "sin numero de serie",
  "sin código",
  "sin codigo",
  "sin identificador",
  "sin id",

  // Información faltante o indeterminada
  "sin información",
  "sin informacion",
  "sin dato",
  "sin datos",
  "no informado",
  "no informada",
  "no ingresado",
  "no ingresada",
  "no indicado",
  "no indicada",
  "desconocido",
  "desconocida",
  "pendiente",
  "por confirmar",
  "por definir",

  // Inglés, solo si FieldBeat puede contener entradas en inglés
  "none",
  "not applicable",
  "not required",
  "no part",
  "no parts",
  "no spare part",
  "no spare parts",
  "without part",
  "without parts",
  "no material",
  "no materials",
  "no information",
  "unknown"
];

const PLACEHOLDER_NORMALIZED_SET = new Set(
  PLACEHOLDER_LITERALS.map(normalizeIdentifier)
);

// Un valor que no deja ningún caracter alfanumérico tras normalizar
// ("---", ".......", espacios) tampoco es un identificador real.
function isPlaceholderValue(normalizedValue) {
  if (!normalizedValue) return true;
  return PLACEHOLDER_NORMALIZED_SET.has(normalizedValue);
}

function enrichFromIdentityMap(productId, identityMap) {
  const found = identityMap.find(r => r.dolibarr_product_id === productId);

  return {
    ref: found?.dolibarr_ref || "",
    barcode: found?.dolibarr_barcode || "",
    label: found?.dolibarr_label || ""
  };
}

// Alias curados a mano (data/config/part_identity_aliases.csv) tienen máxima
// prioridad: un humano ya decidió a qué producto corresponde ese literal,
// así que pisan incluso un placeholder detectado automáticamente.
function resolveManualAlias(raw, normalizedRaw, aliasRows, identityMap) {
  for (const alias of aliasRows) {
    const aliasValue = String(alias.alias_value || "").trim();
    if (!aliasValue) continue;

    const aliasType = String(alias.alias_type || "").trim().toUpperCase();

    const isMatch = aliasType === "NORMALIZED"
      ? normalizeIdentifier(aliasValue) === normalizedRaw
      : aliasValue === raw;

    if (!isMatch) continue;

    const productId = String(alias.dolibarr_product_id || "").trim();
    const enrichment = enrichFromIdentityMap(productId, identityMap);

    return {
      raw_part_identifier: raw,
      normalized_part_identifier: normalizedRaw,
      dolibarr_product_id: productId,
      dolibarr_ref: alias.dolibarr_ref || enrichment.ref,
      dolibarr_barcode: enrichment.barcode,
      dolibarr_label: enrichment.label,
      match_method: "MANUAL_ALIAS_EXACT",
      match_confidence: 1,
      match_status: "MATCHED",
      needs_manual_review: false,
      candidate_dolibarr_product_ids: ""
    };
  }

  return null;
}

function dedupeByProduct(rows) {
  const map = new Map();

  for (const row of rows) {
    if (!map.has(row.dolibarr_product_id)) {
      map.set(row.dolibarr_product_id, row);
    }
  }

  return Array.from(map.values());
}

function buildResult(rawValue, normalizedValue, method, confidence, candidateRows) {
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

// Cascada de resolución de identidad. Se detiene en el primer nivel que
// produzca candidatos; ID_EXACT por diseño solo se evalúa si REF/BARCODE
// no encontraron nada, así nunca compite con ellos.
//
// Orden de precedencia: alias manual -> placeholder -> cascada automática.
// El alias manual pisa todo lo demás porque es una decisión humana explícita.
// El placeholder se evalúa antes de intentar cualquier match automático
// (incluyendo REF_EXACT), no solo antes de REF_LIKE, porque un valor como
// "sin numero" no debe intentar matchear contra Dolibarr en absoluto.
export function resolvePartIdentity(rawValue, identityMap, aliasRows = []) {
  const raw = String(rawValue ?? "").trim();
  const normalizedRaw = normalizeIdentifier(raw);

  // Nota: un raw vacío (o solo espacios) también cae en isPlaceholderValue()
  // más abajo, porque normalizedRaw queda "" -> se clasifica PLACEHOLDER_VALUE,
  // no NO_MATCH. No hay early-return especial aquí a propósito.
  const aliasResult = resolveManualAlias(raw, normalizedRaw, aliasRows, identityMap);
  if (aliasResult) return aliasResult;

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

  const byRef = identityMap.filter(r => r.identity_type === "REF");
  const byBarcode = identityMap.filter(r => r.identity_type === "BARCODE");
  const byId = identityMap.filter(r => r.identity_type === "ID");

  const refExact = byRef.filter(r => String(r.identity_value || "").trim() === raw);
  if (refExact.length > 0) {
    return buildResult(raw, normalizedRaw, "REF_EXACT", 1, refExact);
  }

  const barcodeExact = byBarcode.filter(r => String(r.identity_value || "").trim() === raw);
  if (barcodeExact.length > 0) {
    return buildResult(raw, normalizedRaw, "BARCODE_EXACT", 1, barcodeExact);
  }

  const idExact = byId.filter(r => String(r.identity_value || "").trim() === raw);
  if (idExact.length > 0) {
    return buildResult(raw, normalizedRaw, "ID_EXACT", 0.9, idExact);
  }

  const refNormalized = byRef.filter(r => r.identity_value_normalized === normalizedRaw);
  if (refNormalized.length > 0) {
    return buildResult(raw, normalizedRaw, "REF_NORMALIZED_EXACT", 0.85, refNormalized);
  }

  const barcodeNormalized = byBarcode.filter(r => r.identity_value_normalized === normalizedRaw);
  if (barcodeNormalized.length > 0) {
    return buildResult(raw, normalizedRaw, "BARCODE_NORMALIZED_EXACT", 0.85, barcodeNormalized);
  }

  if (normalizedRaw.length >= MIN_LIKE_LENGTH) {
    const refLike = byRef.filter(r => {
      const value = r.identity_value_normalized || "";
      if (value.length < MIN_LIKE_LENGTH) return false;
      return normalizedRaw.includes(value) || value.includes(normalizedRaw);
    });

    if (refLike.length > 0) {
      return buildResult(raw, normalizedRaw, "REF_LIKE", 0.5, refLike);
    }
  }

  return buildResult(raw, normalizedRaw, "NONE", 0, []);
}
