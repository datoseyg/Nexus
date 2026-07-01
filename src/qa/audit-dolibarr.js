import fs from "node:fs/promises";
import { readCsv } from "../lib/csv.js";

const BASE_DIR = "data/processed/dolibarr";

const FILES = {
  products: "DB_Dolibarr_Products.csv",
  identityMap: "DIM_Dolibarr_Product_Identity_Map.csv"
};

function countDuplicates(rows, keyName) {
  const seen = new Set();
  const duplicates = [];

  for (const row of rows) {
    const key = String(row[keyName] || "").trim();

    if (!key) continue;

    if (seen.has(key)) {
      duplicates.push(key);
    }

    seen.add(key);
  }

  return duplicates;
}

function percent(numerator, denominator) {
  if (!denominator) return "0.00%";
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

function findRefsSharedByMultipleProducts(identityMap) {
  const refToProducts = new Map();

  for (const row of identityMap) {
    if (row.identity_type !== "REF") continue;

    const ref = String(row.identity_value || "").trim();
    if (!ref) continue;

    if (!refToProducts.has(ref)) refToProducts.set(ref, new Set());
    refToProducts.get(ref).add(row.dolibarr_product_id);
  }

  return Array.from(refToProducts.entries())
    .filter(([, productIds]) => productIds.size > 1)
    .map(([ref, productIds]) => ({ ref, product_ids: Array.from(productIds) }));
}

async function auditDolibarr() {
  console.log("=== AUDITORÍA DOLIBARR NORMALIZADO ===");

  const products = await readCsv(`${BASE_DIR}/${FILES.products}`);
  const identityMap = await readCsv(`${BASE_DIR}/${FILES.identityMap}`);

  const productsWithRef = products.filter(p => String(p.ref || "").trim());
  const productsWithBarcode = products.filter(p => String(p.barcode || "").trim());

  const duplicateProducts = countDuplicates(products, "dolibarr_product_id");
  const duplicateIdentityRows = countDuplicates(identityMap, "identity_id");

  const refsSharedByMultipleProducts = findRefsSharedByMultipleProducts(identityMap);

  const identityTypeBreakdown = {};
  for (const row of identityMap) {
    identityTypeBreakdown[row.identity_type] = (identityTypeBreakdown[row.identity_type] || 0) + 1;
  }

  const statusBreakdown = {};
  for (const product of products) {
    const status = product.status || "(sin status)";
    statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
  }

  const report = {
    generated_at: new Date().toISOString(),
    row_counts: {
      DB_Dolibarr_Products: products.length,
      DIM_Dolibarr_Product_Identity_Map: identityMap.length
    },
    coverage: {
      products_with_ref: productsWithRef.length,
      products_without_ref: products.length - productsWithRef.length,
      ref_coverage: percent(productsWithRef.length, products.length),
      products_with_barcode: productsWithBarcode.length,
      barcode_coverage: percent(productsWithBarcode.length, products.length)
    },
    identity_map: {
      identity_type_breakdown: identityTypeBreakdown,
      refs_shared_by_multiple_products: refsSharedByMultipleProducts.length
    },
    duplicates: {
      duplicate_products: duplicateProducts.length,
      duplicate_identity_rows: duplicateIdentityRows.length
    },
    status_breakdown: statusBreakdown,
    samples: {
      first_10_products: products.slice(0, 10).map(p => ({
        dolibarr_product_id: p.dolibarr_product_id,
        ref: p.ref,
        barcode: p.barcode,
        label: p.label
      })),
      refs_shared_by_multiple_products_sample: refsSharedByMultipleProducts.slice(0, 10)
    }
  };

  await fs.mkdir("data/reports", { recursive: true });

  await fs.writeFile(
    "data/reports/dolibarr_audit_report.json",
    JSON.stringify(report, null, 2),
    "utf8"
  );

  console.log(JSON.stringify(report, null, 2));
  console.log("Reporte guardado en data/reports/dolibarr_audit_report.json");
}

auditDolibarr().catch(error => {
  console.error("ERROR AUDITANDO DOLIBARR:");
  console.error(error);
  process.exit(1);
});
