require("dotenv").config({ path: __dirname + "/../.env" });
const fs = require("fs");
const { Client } = require("pg");

const connectionString = process.env.WORKING_HOURS_DB_URL;
if (!connectionString || !connectionString.includes("localhost")) {
  console.error("REFUSING: not a localhost connection string.");
  process.exit(1);
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node apply_migration.cjs <path-to-sql-file>");
    process.exit(1);
  }
  const sql = fs.readFileSync(file, "utf8");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("COMMIT");
    console.log(`Applied ${file} OK (committed).`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("ERROR applying migration, rolled back:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
