// Read-only query helper against the local disposable Postgres (nexus_bi_dev_local_test).
// Usage: node scratchpad/pgq_readonly_diag.js "<SQL>"
require("dotenv").config({ path: __dirname + "/../.env" });
const { Client } = require("pg");

const connectionString = process.env.WORKING_HOURS_DB_URL;
if (!connectionString || !connectionString.includes("localhost")) {
  console.error("REFUSING: WORKING_HOURS_DB_URL is not a localhost connection string.");
  process.exit(1);
}

async function main() {
  const sql = process.argv[2];
  if (!sql) {
    console.error('Usage: node pgq_readonly_diag.js "<SQL>"');
    process.exit(1);
  }
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("SET default_transaction_read_only = on");
    await client.query("BEGIN");
    const res = await client.query(sql);
    console.log(JSON.stringify(res.rows, null, 2));
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
