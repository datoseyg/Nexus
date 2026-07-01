import "dotenv/config";
import { fileURLToPath } from "node:url";
import { getJson } from "../lib/http.js";
import { saveJson, timestampForFile } from "../lib/save-json.js";

const {
  DOLIBARR_URL,
  DOLIBARR_TOKEN
} = process.env;

const LIMIT = 100;
const MAX_PAGES = 50;

export async function mineDolibarrProducts() {
  if (!DOLIBARR_URL || !DOLIBARR_TOKEN) {
    throw new Error("Faltan variables DOLIBARR_URL o DOLIBARR_TOKEN en .env");
  }

  let page = 0;
  let total = 0;

  while (page < MAX_PAGES) {
    const url =
      `${DOLIBARR_URL}/api/index.php/products?limit=${LIMIT}&page=${page}`;

    console.log(`Dolibarr página ${page}: ${url}`);

    const data = await getJson(url, {
      headers: {
        DOLAPIKEY: DOLIBARR_TOKEN
      }
    });

    const products = Array.isArray(data) ? data : [];

    await saveJson(
      `data/raw/dolibarr/products_page_${page}_${timestampForFile()}.json`,
      data
    );

    total += products.length;

    if (products.length < LIMIT) break;

    page++;
  }

  console.log(`Dolibarr finalizado. Productos descargados: ${total}`);
  return total;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  mineDolibarrProducts().catch(error => {
    console.error(error);
    process.exit(1);
  });
}