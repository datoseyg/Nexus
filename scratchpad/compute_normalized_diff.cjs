require("dotenv").config({ path: __dirname + "/../.env" });
const { Client } = require("pg");

const connectionString = process.env.WORKING_HOURS_DB_URL;
if (!connectionString || !connectionString.includes("localhost")) {
  console.error("REFUSING: not a localhost connection string.");
  process.exit(1);
}

// Full current PLACEHOLDER_LITERALS from src/resolvers/part-identity-resolver.js (working tree, uncommitted).
const PLACEHOLDER_LITERALS = [
  "",
  "n/a", "na", "n.c.", "n/c", "nc", "s/d", "sd",
  "no", "ninguno", "ninguna", "ningún", "ningun", "nada",
  "no hay", "no existe", "no existen", "no tiene", "no tienen", "no posee", "no poseen",
  "no presenta", "no presentan", "no registra", "no registrado", "no registrada", "no disponible",
  "no aplica", "no aplicable", "no corresponde", "no correspondía", "no correspondia",
  "no procede", "no requerido", "no requerida", "no requiere", "no se requiere",
  "sin repuesto", "sin repuestos", "sin uso de repuesto", "sin uso de repuestos",
  "sin utilizar repuesto", "sin utilizar repuestos",
  "no utilizó repuesto", "no utilizo repuesto", "no utilizó repuestos", "no utilizo repuestos",
  "no se utilizó repuesto", "no se utilizo repuesto", "no se utilizaron repuestos",
  "no se usó repuesto", "no se uso repuesto", "no se usaron repuestos",
  "repuesto no utilizado", "repuestos no utilizados",
  "no consume", "no consumió", "no consumio", "no se consumió", "no se consumio",
  "sin consumo", "sin consumos",
  "sin material", "sin materiales", "sin insumo", "sin insumos",
  "no se usaron materiales", "no se utilizaron materiales", "no se usaron insumos", "no se utilizaron insumos",
  "sin número", "sin numero", "sin nro", "sin n°", "sin num", "s/n", "sn",
  "sin serie", "sin número de serie", "sin numero de serie",
  "sin código", "sin codigo", "sin identificador", "sin id",
  "sin información", "sin informacion", "sin dato", "sin datos",
  "no informado", "no informada", "no ingresado", "no ingresada", "no indicado", "no indicada",
  "desconocido", "desconocida", "pendiente", "por confirmar", "por definir",
  "none", "not applicable", "not required", "no part", "no parts",
  "no spare part", "no spare parts", "without part", "without parts",
  "no material", "no materials", "no information", "unknown"
];

async function main() {
  const client = new Client({ connectionString });
  await client.connect();

  const existingRes = await client.query("SELECT normalized_value FROM quality.part_no_usage_markers");
  const existing = new Set(existingRes.rows.map(r => r.normalized_value));

  const seen = new Map(); // normalized -> [raw literals]
  for (const literal of PLACEHOLDER_LITERALS) {
    const r = await client.query("SELECT quality.normalize_part_declaration($1) AS n", [literal]);
    const norm = r.rows[0].n;
    if (!seen.has(norm)) seen.set(norm, []);
    seen.get(norm).push(literal === "" ? "<empty>" : literal);
  }

  const rows = [];
  for (const [norm, raws] of seen.entries()) {
    rows.push({ norm, raws, alreadyMarker: existing.has(norm) });
  }
  rows.sort((a, b) => a.norm.localeCompare(b.norm));

  console.log(JSON.stringify(rows, null, 2));
  await client.end();
}

main().catch(err => { console.error("ERROR:", err.message); process.exit(1); });
