require("dotenv").config({ path: __dirname + "/../.env" });
const { Client } = require("pg");

const connectionString = process.env.WORKING_HOURS_DB_URL;
if (!connectionString || !connectionString.includes("localhost")) {
  console.error("REFUSING: not a localhost connection string.");
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT role, array_agg(capability ORDER BY capability) AS caps FROM governance.role_capabilities GROUP BY role ORDER BY role"
    );
    for (const row of rows) {
      console.log(`${row.role} (${row.caps.length}): ${row.caps.join(", ")}`);
    }
    const gerencia = rows.find(r => r.role === "gerencia")?.caps ?? [];
    const administracion = rows.find(r => r.role === "administracion")?.caps ?? [];
    const equal = JSON.stringify(gerencia) === JSON.stringify(administracion);
    console.log(`\nEQUAL: ${equal}`);
  } finally {
    await client.end();
  }
}

main();
