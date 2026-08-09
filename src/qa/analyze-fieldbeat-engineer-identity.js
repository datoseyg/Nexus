// Analisis offline, de un solo uso, para poblar manual_review.fieldbeat_engineer_identity_map
// (sql/088_fieldbeat_part_occurrences_and_participants.sql) con filas AUTO_EVIDENCED.
//
// Cruza processed.fieldbeat_tasks.assigned_to (username) contra sign.worker.name
// (el bloque de firma digital del propio JSON crudo de FieldBeat, NUNCA ingerido
// hoy a Postgres) para proponer un canonical_display_name por username - SOLO
// cuando exista un candidato mayoritario INEQUIVOCO que ademas calce con el
// roster de "NOMBRE DEL INGENIERO ADICIONAL". Nunca genera un mapping cuando
// hay 2+ candidatos competidores, nombres incompatibles, o la evidencia no es
// clara - en esos casos el username queda simplemente fuera de este seed
// (sus tokens en el campo adicional quedaran como participantes no resueltos
// hasta que alguien los cure manualmente).
//
// Este script NUNCA se ejecuta durante el bootstrap de sql/088 - es un
// artefacto de analisis, persistido para auditabilidad/reproducibilidad. Las
// filas resultantes se copian ESTATICAMENTE al archivo de migracion.
//
// Uso: node src/qa/analyze-fieldbeat-engineer-identity.js
import fs from "node:fs/promises";

const RAW_FILE = "data/raw/fieldbeat/all_tasks_latest.json";

// Mismo alfabeto de acentos que quality.normalize_engineer_name() en SQL -
// ambos deben producir el mismo resultado para el mismo input (ver prueba de
// equivalencia SQL<->TS exigida por el plan). Esta funcion es la que se usa
// para el parseo EN VIVO de participantes (valores de dropdown de
// field_value, siempre limpios) - NUNCA se modifica para acomodar el ruido
// de sign.worker.name, ver mas abajo.
const ACCENTS_FROM = "áàäâãÁÀÄÂÃéèëêÉÈËÊíìïîÍÌÏÎóòöôõÓÒÖÔÕúùüûÚÙÜÛñÑçÇ";
const ACCENTS_TO   = "aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUnNcC";

export function normalizeEngineerName(raw) {
  if (!raw) return "";
  let out = "";
  for (const ch of String(raw)) {
    const idx = ACCENTS_FROM.indexOf(ch);
    out += idx >= 0 ? ACCENTS_TO[idx] : ch;
  }
  return out.toUpperCase().replace(/\s+/g, " ").trim();
}

// SOLO para este analisis offline: sign.worker.name es una firma digital de
// texto libre, no un dropdown - el mismo Manuel Reyes aparece como "Manuel
// Reyes", "Manuel Reyes I", "Manuel Reyes I.", y "Manuel Reyes Irrazaval"
// (verificado: "Irrazaval" aparece explicito 16 veces para mreyes,
// confirmando que "I"/"I." es una abreviatura real de un segundo apellido,
// no una persona distinta - patron de nombres chilenos con 2 apellidos,
// registrado de forma inconsistente en la firma). Comparar por los primeros
// 2 tokens (nombre + primer apellido) es la regla GENERAL que resuelve esto
// para CUALQUIER username, no un caso especial de Manuel Reyes - verificado
// sin colisiones contra las 20 entradas del roster (ningun par de personas
// distintas del roster comparte los mismos primeros 2 tokens).
function firstTwoTokens(normalizedFull) {
  return normalizedFull.split(" ").filter(Boolean).slice(0, 2).join(" ");
}

const OTROS_TOKEN_RE = /^OTROS?\s*\(\s*COMENTE\s*\)$/i;

async function main() {
  const raw = JSON.parse(await fs.readFile(RAW_FILE, "utf8"));

  // 1. Roster: union de TODOS los possible_values historicos del campo
  // "NOMBRE DEL INGENIERO ADICIONAL" (nombre EXACTO, unico literal confirmado
  // en las 3747 tareas reales), excluyendo el marcador "OTROS (COMENTE)".
  // Clave = primeros 2 tokens normalizados; valor = token ORIGINAL (con sus
  // acentos reales) - el original es la fuente para canonical_display_name,
  // nunca se reconstruye reversando el stripping de acentos.
  const roster = new Map(); // "NOMBRE APELLIDO" (2 tokens) -> token original completo
  for (const t of raw.tasks) {
    for (const g of t.report?.groups ?? []) {
      for (const f of g.fields ?? []) {
        if (f.name !== "NOMBRE DEL INGENIERO ADICIONAL" || !f.possible_values) continue;
        for (const token of f.possible_values.split(",")) {
          const trimmed = token.trim();
          if (!trimmed || OTROS_TOKEN_RE.test(trimmed)) continue;
          const key = firstTwoTokens(normalizeEngineerName(trimmed));
          if (!roster.has(key)) roster.set(key, trimmed);
        }
      }
    }
  }

  // 2. Por username (assigned_to): distribucion de sign.worker.name, tanto
  // por clave de 2 tokens (decision) como por texto normalizado completo
  // (evidencia legible en el reason/evidence de la fila sembrada).
  const byUsername = new Map(); // username -> { byKey: Map(key2 -> count), byFull: Map(fullNormalized -> count) }
  for (const t of raw.tasks) {
    const username = t.assigned_to;
    const signatureName = t.sign?.worker?.name;
    if (!username || !signatureName) continue;
    const fullNormalized = normalizeEngineerName(signatureName);
    if (!fullNormalized) continue;
    const key2 = firstTwoTokens(fullNormalized);
    if (!byUsername.has(username)) byUsername.set(username, { byKey: new Map(), byFull: new Map() });
    const entry = byUsername.get(username);
    entry.byKey.set(key2, (entry.byKey.get(key2) ?? 0) + 1);
    entry.byFull.set(fullNormalized, (entry.byFull.get(fullNormalized) ?? 0) + 1);
  }

  console.log(`Snapshot analizado: ${RAW_FILE}, extracted_at=${raw.extracted_at}, total tareas=${raw.total}`);
  console.log(`Roster (union historica, primeros 2 tokens, sin "OTROS"): ${roster.size} nombres distintos`);
  console.log([...roster.values()].sort().join(" | "));
  console.log(`Usernames con al menos 1 firma: ${byUsername.size}\n`);

  const accepted = [];
  const rejected = [];

  for (const [username, { byKey, byFull }] of [...byUsername.entries()].sort()) {
    const keyEntries = [...byKey.entries()].sort((a, b) => b[1] - a[1]);
    const total = keyEntries.reduce((sum, [, c]) => sum + c, 0);
    const [topKey, topCount] = keyEntries[0];
    const fullEntries = [...byFull.entries()].sort((a, b) => b[1] - a[1]);

    const isRosterMatch = roster.has(topKey);
    // Inequivoco = el candidato principal (por 2 tokens) es mayoria clara
    // (>50% del total de firmas) Y calza con el roster. Nunca se acepta un
    // candidato fuera del roster (evita firmas erroneas/placeholder tipo
    // "prueba de formato"/"nombre trabajador" coladas como si fueran reales).
    const isUnambiguous = topCount > total / 2 && isRosterMatch;

    const record = { username, topKey, topCount, total, isRosterMatch, fullEntries };
    if (isUnambiguous) accepted.push(record);
    else rejected.push(record);
  }

  console.log(`=== ACEPTADOS (${accepted.length}) - mayoria inequivoca (primeros 2 tokens) + coincide con roster ===`);
  for (const r of accepted) {
    console.log(`  ${r.username} -> "${r.topKey}"  (${r.topCount}/${r.total} ocurrencias de sign.worker.name)`);
  }

  console.log(`\n=== RECHAZADOS (${rejected.length}) - ambiguo o sin coincidencia de roster, quedan sin mapping ===`);
  for (const r of rejected) {
    const reason = !r.isRosterMatch ? "candidato principal no esta en el roster" : "sin mayoria clara (competencia de identidad)";
    console.log(`  ${r.username}: top="${r.topKey}" (${r.topCount}/${r.total}), ${reason}`);
  }

  console.log(`\n=== SQL a copiar ESTATICAMENTE en sql/088 (INSERT ... ON CONFLICT DO NOTHING) ===`);
  console.log("INSERT INTO manual_review.fieldbeat_engineer_identity_map");
  console.log("  (source_type, source_value_normalized, canonical_person_key, canonical_display_name, verification_method, confidence, reason, evidence, created_by)");
  console.log("VALUES");
  const escSql = s => s.replace(/'/g, "''");
  const rows = accepted.map(r => {
    const reason = `${r.topCount}/${r.total} ocurrencias de sign.worker.name normalizan (primeros 2 tokens: nombre + primer apellido) a este nombre; coincide con el roster de NOMBRE DEL INGENIERO ADICIONAL`;
    const evidence = r.fullEntries.map(([name, count]) => `${name}=${count}`).join(", ");
    // canonical_display_name usa el token ORIGINAL del roster (con sus
    // acentos reales), nunca una reconstruccion del nombre normalizado.
    const displayName = roster.get(r.topKey);
    return `  ('ASSIGNED_TO_USERNAME', '${escSql(r.username)}', '${escSql(r.username)}', '${escSql(displayName)}', 'AUTO_EVIDENCED', 'HIGH', '${escSql(reason)}', '${escSql(evidence)}', 'migration-088-evidence-seed')`;
  });
  console.log(rows.join(",\n") + "\nON CONFLICT (source_type, source_value_normalized) DO NOTHING;");
}

main().catch(err => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
