import fs from "node:fs/promises";
import path from "node:path";
import { writeCsv } from "../lib/csv.js";
import { normalizeIdentifier } from "../resolvers/part-identity-resolver.js";

const RAW_DIR = "data/raw/dolibarr";
const OUTPUT_DIR = "data/processed/dolibarr";

function makeKey(...parts) {
  return parts.map(x => String(x ?? "").trim()).join("|");
}

async function loadAllProducts() {
  const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith(".json"));

  const productsById = new Map();

  for (const file of files) {
    const raw = await fs.readFile(path.join(RAW_DIR, file), "utf8");
    const payload = JSON.parse(raw);
    const products = Array.isArray(payload) ? payload : [];

    for (const product of products) {
      const id = String(product?.id ?? "").trim();
      if (!id) continue;
      productsById.set(id, product);
    }
  }

  return Array.from(productsById.values());
}

function buildDolibarrTables(products) {
  const productRows = [];
  const identityRows = [];

  const extractedAt = new Date().toISOString();

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

  return { productRows, identityRows };
}

function dedupeBy(rows, keyName) {
  const map = new Map();

  for (const row of rows) {
    const key = row[keyName];
    if (!key) continue;
    map.set(key, row);
  }

  return Array.from(map.values());
}

async function normalizeDolibarr() {
  console.log("=== Normalizando Dolibarr RAW ===");

  const products = await loadAllProducts();
  console.log(`Productos únicos leídos desde RAW: ${products.length}`);

  const { productRows, identityRows } = buildDolibarrTables(products);

  await writeCsv(`${OUTPUT_DIR}/DB_Dolibarr_Products.csv`, dedupeBy(productRows, "dolibarr_product_id"));
  await writeCsv(`${OUTPUT_DIR}/DIM_Dolibarr_Product_Identity_Map.csv`, dedupeBy(identityRows, "identity_id"));

  console.log("=== Normalización Dolibarr finalizada ===");
}

normalizeDolibarr().catch(error => {
  console.error("ERROR NORMALIZANDO DOLIBARR:");
  console.error(error);
  process.exit(1);
});
