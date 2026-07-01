import { mineDolibarrProducts } from "./miners/dolibarr.js";
import { mineZendeskTickets } from "./miners/zendesk.js";
import { mineAllFieldBeatTasks } from "./miners/fieldbeat-all.js";

async function runAll() {
  console.log("=== EYG Nexus Local Miner ===");

  console.log("\n1/3 Dolibarr");
  await mineDolibarrProducts();

  console.log("\n2/3 Zendesk");
  await mineZendeskTickets();

  console.log("\n3/3 FieldBeat");
  await mineAllFieldBeatTasks();

  console.log("\nMinería local finalizada.");
}

runAll().catch(error => {
  console.error(error);
  process.exit(1);
});