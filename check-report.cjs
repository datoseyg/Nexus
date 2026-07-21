const fs = require("fs");

const report = JSON.parse(
fs.readFileSync(process.argv[2],"utf8")
);

const rows = report.rows ?? {};

const total =
Number(rows.accepted??0)+
Number(rows.ignored??0)+
Number(rows.errored??0);

const checks={
readIs40:rows.read===40,
acceptedIs23:rows.accepted===23,
ignoredIs17:rows.ignored===17,
erroredIs0:rows.errored===0,
invariant:rows.read===total,
matchSourceIsDB:report.matchSource==="DB",
noDuplicateEquipmentKeys:
Array.isArray(report.duplicateEquipmentKeysWithinFile)&&
report.duplicateEquipmentKeysWithinFile.length===0
};

console.table(checks);

if(Object.values(checks).some(x=>!x))
process.exit(1);
