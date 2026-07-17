const fs = require("fs");

const report = JSON.parse(
  fs.readFileSync(process.argv[2], "utf8")
);

const details = report.fieldbeatMatches?.details ?? [];

const pending = details.filter(
  x => x.matchStatus !== "MATCHED"
);

console.table(
  pending.map(x => ({
    equipmentKey: x.equipmentKey,
    status: x.matchStatus,
    method: x.matchMethod,
    candidates: x.candidateCount,
  }))
);

console.log("Pendientes:", pending.length);
