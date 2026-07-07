import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Auditoría de estructura reproducible - escanea el repo completo (con
// exclusiones seguras), clasifica cada archivo relevante, y genera un
// inventario machine-readable + un resumen. NO borra, mueve ni modifica
// ningún archivo del proyecto - solo lee y escribe sus propias salidas
// (data/reports/project_file_inventory.*, data/reports/project_structure_audit_summary.json).
// Ver docs/PROJECT_FILE_INVENTORY.md para la versión curada para humanos.

const ROOT = process.cwd();

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "out",
  "dist",
  "build",
  "coverage"
]);

// Rutas (relativas a la raíz) excluidas del escaneo profundo por instrucción
// explícita - inmutables, binarios de warehouse, o secretos.
const EXCLUDED_PATH_PREFIXES = ["data/raw/"];
const EXCLUDED_EXACT_PATHS = new Set([".env"]);
const EXCLUDED_EXTENSIONS = new Set([".duckdb", ".wal"]);

const LARGE_FILE_BYTES = 1_000_000; // 1MB

const OUTPUT_JSON = "data/reports/project_file_inventory.json";
const OUTPUT_CSV = "data/reports/project_file_inventory.csv";
const SUMMARY_FILE = "data/reports/project_structure_audit_summary.json";

// --- Extensiones de texto donde vale la pena buscar patrones de secreto.
// .env queda explícitamente excluido (ver EXCLUDED_EXACT_PATHS) - ahí se
// esperan credenciales reales por diseño y ya está en .gitignore; lo que
// esta auditoría busca es un secreto HARDCODEADO por error en un archivo
// versionado (código/config/doc), que sí sería un problema real.
const TEXT_EXTENSIONS = new Set([".js", ".ts", ".tsx", ".jsx", ".json", ".md", ".css", ".sql", ".http", ".txt", ".mjs", ".cjs"]);

const SECRET_PATTERNS = [
  { name: "ASSIGNED_TOKEN_OR_KEY", regex: /\b[A-Za-z_]*(API[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE[_-]?KEY)\b\s*[:=]\s*["']?[A-Za-z0-9+/_\-]{12,}["']?/i },
  { name: "AWS_ACCESS_KEY_ID", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "BEARER_TOKEN_LITERAL", regex: /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}={0,2}\b/ }
];

function isExcludedDir(name) {
  return EXCLUDED_DIRS.has(name);
}

function isExcludedPath(relPath) {
  const normalized = relPath.split(path.sep).join("/");
  if (EXCLUDED_EXACT_PATHS.has(normalized)) return true;
  if (EXCLUDED_PATH_PREFIXES.some(prefix => normalized.startsWith(prefix))) return true;
  if (EXCLUDED_EXTENSIONS.has(path.extname(normalized))) return true;
  return false;
}

async function walk(dir, relBase = "") {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  let dirsScanned = 0;

  for (const entry of entries) {
    const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (isExcludedDir(entry.name)) continue;
      if (isExcludedPath(`${relPath}/`)) continue;

      dirsScanned += 1;
      const nested = await walk(path.join(dir, entry.name), relPath);
      files.push(...nested.files);
      dirsScanned += nested.dirsScanned;
    } else if (entry.isFile()) {
      if (isExcludedPath(relPath)) continue;
      files.push(relPath);
    }
  }

  return { files, dirsScanned };
}

// --- Clasificación por patrón de ruta. Cascada: la primera regla que
// matchea gana. Ver docs/PROJECT_FILE_INVENTORY.md para el razonamiento
// completo detrás de cada categoría.
function classify(relPath) {
  const p = relPath.split(path.sep).join("/");
  const ext = path.extname(p);

  const rule = (type, category, source, version, risk, responsibility) => ({
    type, category, source_or_generated: source, should_version: version, risk, responsibility
  });

  if (p === "package.json" || p === "package-lock.json") {
    return rule("configuración", "configuración", p.includes("lock") ? "GENERATED" : "SOURCE", true, p.includes("lock") ? "MEDIO" : "ALTO", "Scripts/dependencias del pipeline raíz");
  }
  if (p === ".gitignore" || p === ".env.example") {
    return rule(p.includes("example") ? "plantilla" : "configuración", "configuración", p.includes("example") ? "TEMPLATE" : "SOURCE", true, "BAJO", "Configuración del repo");
  }
  if (p === "CLAUDE.md" || p === "README.md" || p === "PROJECT_INDEX.md") {
    return rule("documentación", "documentación", "DOC", true, "BAJO", "Documentación raíz");
  }
  if (p === "nodenpm") {
    return rule("desconocido", "legacy/sospechoso", "UNKNOWN", false, "BAJO", "Archivo de 0 bytes sin referencias conocidas - ver PROJECT_CLEANUP_CANDIDATES.md");
  }
  if (p === "src/request.http") {
    return rule("desconocido", "legacy/sospechoso", "SOURCE", false, "BAJO", "Duplicado obsoleto de src/run-all.js guardado con nombre/extensión equivocados - ver PROJECT_CLEANUP_CANDIDATES.md");
  }

  if (p.startsWith("src/miners/")) return rule("código", "miner", "SOURCE", true, "ALTO", "Extracción desde API externa (RAW)");
  if (p.startsWith("src/normalizers/")) return rule("código", "normalizer", "SOURCE", true, "ALTO", "Transforma RAW en PROCESSED");
  if (p.startsWith("src/resolvers/")) return rule("código", "resolver", "SOURCE", true, "ALTO", "Resolución de identidad (repuestos FieldBeat<->Dolibarr)");
  if (p.startsWith("src/marts/")) return rule("código", "mart builder", "SOURCE", true, "MEDIO", "Construye vistas intermedias de negocio (mart)");
  if (p.startsWith("src/gold/")) return rule("código", "gold builder", "SOURCE", true, "MEDIO", "Construye datasets finales agregados (GOLD)");
  if (p.startsWith("src/db/")) return rule("código", "duckdb warehouse", "SOURCE", true, "ALTO", "Inicializa/carga/valida el warehouse DuckDB");
  if (p.startsWith("src/qa/")) return rule("código", "auditoría", "SOURCE", true, "BAJO", "Validaciones/auditorías de solo lectura");
  if (p.startsWith("src/curation/")) return rule("código", "curación", "SOURCE", true, "BAJO", "Valida schema de archivos de curación manual");
  if (p.startsWith("src/lib/")) return rule("código", "configuración", "SOURCE", true, "ALTO", "Helper compartido del pipeline");
  if (p === "src/run-all.js") return rule("script", "sincronización", "SOURCE", true, "ALTO", "Orquesta los 3 miners en secuencia");

  if (p.startsWith("apps/nexus-bi-app/app/api/")) return rule("endpoint/API", "app API", "SOURCE", true, "MEDIO", "Route Handler de Next.js (solo lectura sobre DuckDB)");
  if (p.startsWith("apps/nexus-bi-app/app/dashboard/")) return rule("app frontend", "dashboard", "SOURCE", true, "BAJO", "Página de dashboard");
  if (p.startsWith("apps/nexus-bi-app/app/audit/")) return rule("app frontend", "auditoría", "SOURCE", true, "BAJO", "Página de auditoría/validación manual");
  if (p.startsWith("apps/nexus-bi-app/app/")) return rule("app frontend", "app UI", "SOURCE", true, "BAJO", "Página/layout de la app");
  if (p.startsWith("apps/nexus-bi-app/components/dashboard/")) return rule("app frontend", "dashboard", "SOURCE", true, "BAJO", "Componente del Dashboard Operacional");
  if (p.startsWith("apps/nexus-bi-app/components/audit/")) return rule("app frontend", "auditoría", "SOURCE", true, "BAJO", "Componente de Auditoría/Validación Manual");
  if (p.startsWith("apps/nexus-bi-app/components/after-hours/")) return rule("app frontend", "dashboard", "SOURCE", true, "BAJO", "Componente de Trabajo Fuera de Horario");
  if (p.startsWith("apps/nexus-bi-app/components/")) return rule("app frontend", "app UI", "SOURCE", true, "BAJO", "Componente compartido de UI");
  if (p.startsWith("apps/nexus-bi-app/lib/")) return rule("código", "app API", "SOURCE", true, "MEDIO", "Helper de servidor/cliente de la app");
  if (p.startsWith("apps/nexus-bi-app/types/")) return rule("código", "app API", "SOURCE", true, "BAJO", "Tipos TS compartidos de la app");
  if (p.startsWith("apps/nexus-bi-app/") && (ext === ".json" || ext === ".ts" || ext === ".mjs" || p.endsWith(".css"))) {
    return rule("configuración", "configuración", p.includes("lock") ? "GENERATED" : "SOURCE", true, "MEDIO", "Configuración del proyecto Next.js");
  }
  if (p.startsWith("apps/nexus-bi-app/")) return rule("documentación", "documentación", "DOC", true, "BAJO", "Documentación de la app");

  if (p.startsWith("data/processed/")) return rule("dato procesado", "dato generado", "GENERATED", true, "ALTO", "CSV normalizado (regenerable desde RAW)");
  if (p.startsWith("data/marts/")) return rule("mart", "dato generado", "GENERATED", true, "MEDIO", "Vista intermedia de negocio (regenerable desde PROCESSED)");
  if (p.startsWith("data/gold/")) return rule("gold", "dato generado", "GENERATED", true, "MEDIO", "Dataset final para BI (regenerable desde MARTS)");
  if (p.startsWith("data/config/")) {
    return rule(p.includes(".example.") ? "plantilla" : "configuración", "configuración", p.includes(".example.") ? "TEMPLATE" : "CONFIG", true, "ALTO", "Configuración de entrada hecha a mano");
  }
  if (p.startsWith("data/curation/")) return rule("plantilla", "curación", "TEMPLATE", true, "BAJO", "Plantilla del modelo de curación (no conectada al pipeline todavía)");
  if (p.startsWith("data/reports/")) return rule("reporte", "dato generado", "REPORT", true, "BAJO", "Resumen de build/QA/validación");

  if (p.startsWith("docs/") && ext === ".md") return rule("documentación", "documentación", "DOC", true, "BAJO", "Documentación técnica/producto");
  if (p.startsWith("docs/")) return rule("documentación", "legacy/sospechoso", "DOC", true, "BAJO", "Material de referencia histórico (no-markdown)");

  if (p.startsWith("sql/") && ext === ".sql") return rule("script", "documentación", "SOURCE", true, "BAJO", "Query SQL reutilizable de ejemplo");
  if (p.startsWith("sql/")) return rule("documentación", "documentación", "DOC", true, "BAJO", "Índice del paquete de queries SQL");

  return rule("desconocido", "legacy/sospechoso", "UNKNOWN", true, "DESCONOCIDO", "No clasificado por ninguna regla conocida - revisar manualmente");
}

// --- Mapa estático (best-effort) de qué produce/consume cada script de
// pipeline conocido - ver docs/SCRIPTS_REGISTRY.md para el detalle narrado.
const PIPELINE_IO = {
  "src/miners/zendesk.js": { consumed_by: ["get:zendesk"], produces: ["data/raw/zendesk/"] },
  "src/miners/fieldbeat.js": { consumed_by: ["get:fieldbeat"], produces: ["data/raw/fieldbeat/"] },
  "src/miners/fieldbeat-all.js": { consumed_by: ["get:fieldbeat:all", "get:all"], produces: ["data/raw/fieldbeat/"] },
  "src/miners/dolibarr.js": { consumed_by: ["get:dolibarr", "get:all"], produces: ["data/raw/dolibarr/"] },
  "src/miners/zendesk-backfill-missing-ticket-ids.js": { consumed_by: ["get:zendesk:backfill-fieldbeat"], produces: ["data/raw/zendesk/backfill_by_fieldbeat_ticket_ids/"] },
  "src/run-all.js": { consumed_by: ["get:all"], produces: ["data/raw/"] },
  "src/normalizers/fieldbeat-normalizer.js": { consumed_by: ["normalize:fieldbeat"], produces: ["data/processed/fieldbeat/"] },
  "src/normalizers/zendesk-normalizer.js": { consumed_by: ["normalize:zendesk"], produces: ["data/processed/zendesk/"] },
  "src/normalizers/dolibarr-normalizer.js": { consumed_by: ["normalize:dolibarr"], produces: ["data/processed/dolibarr/"] },
  "src/marts/build-used-parts-dolibarr-match.js": { consumed_by: ["build:used-parts-dolibarr-match"], produces: ["data/marts/Used_Parts_Dolibarr_Match.csv"] },
  "src/marts/build-ticket-fieldbeat-view.js": { consumed_by: ["build:ticket-fieldbeat-view"], produces: ["data/marts/Ticket_FieldBeat_Operational_View.csv"] },
  "src/marts/build-ticket-fieldbeat-dolibarr-view.js": { consumed_by: ["build:ticket-fieldbeat-dolibarr-view"], produces: ["data/marts/Ticket_FieldBeat_Dolibarr_Operational_View.csv"] },
  "src/marts/build-fieldbeat-report-dolibarr-view.js": { consumed_by: ["build:fieldbeat-report-dolibarr-view"], produces: ["data/marts/FieldBeat_Report_Dolibarr_Operational_View.csv"] },
  "src/marts/build-fieldbeat-working-hours-analysis.js": { consumed_by: ["build:fieldbeat-working-hours"], produces: ["data/marts/FieldBeat_Working_Hours_Analysis.csv"] },
  "src/gold/build-gold.js": { consumed_by: ["build:gold"], produces: ["data/gold/"] },
  "src/gold/build-fieldbeat-gold.js": { consumed_by: ["build:gold:fieldbeat"], produces: ["data/gold/"] },
  "src/gold/build-after-hours-gold.js": { consumed_by: ["build:gold:after-hours"], produces: ["data/gold/"] },
  "src/db/init-duckdb.js": { consumed_by: ["db:init", "db:build"], produces: ["data/warehouse/eyg_nexus.duckdb"] },
  "src/db/load-duckdb.js": { consumed_by: ["db:load", "db:build"], produces: ["data/warehouse/eyg_nexus.duckdb"] },
  "src/db/validate-duckdb.js": { consumed_by: ["db:validate", "db:build"], produces: ["data/reports/duckdb_validation_summary.json"] },
  "src/qa/final-phase1-audit.js": { consumed_by: ["qa:phase1"], produces: ["data/reports/phase1_final_audit_summary.json"] },
  "src/curation/validate-curation-files.js": { consumed_by: ["curation:validate"], produces: ["data/reports/curation_validation_summary.json"] }
};

async function readPackageScripts() {
  try {
    const raw = await fs.readFile("package.json", "utf8");
    return JSON.parse(raw).scripts || {};
  } catch {
    return {};
  }
}

// Módulos que se importan (no se corren standalone) a propósito - nunca
// deberían tener su propio script en package.json.
const KNOWN_IMPORTED_MODULES = new Set(["src/db/warehouse-config.js"]);

function findOrphanPipelineScripts(files, scripts) {
  const scriptCommands = Object.values(scripts).join(" ");
  const orphans = [];

  for (const file of files) {
    const p = file.split(path.sep).join("/");
    if (KNOWN_IMPORTED_MODULES.has(p)) continue;

    const isPipelineEntryCandidate =
      (p.startsWith("src/miners/") || p.startsWith("src/normalizers/") || p.startsWith("src/qa/") ||
        p.startsWith("src/marts/") || p.startsWith("src/gold/") || p.startsWith("src/db/") ||
        p.startsWith("src/curation/") || p === "src/run-all.js") &&
      p.endsWith(".js") &&
      !p.endsWith(".prettierrc");

    if (!isPipelineEntryCandidate) continue;
    if (scriptCommands.includes(p)) continue;

    orphans.push(p);
  }

  return orphans;
}

// Heurística cruda (grep-like) para componentes/lib de la app: si el
// nombre de archivo (sin extensión) no aparece en el contenido de NINGÚN
// otro archivo .ts/.tsx de la app, se marca como posible huérfano. No es
// perfecto (no resuelve alias `@/` de forma exacta), pero coincide con lo
// que ya se confirmó a mano para EmptyState.tsx/FilterPanel.tsx.
async function findOrphanAppFiles(files) {
  const appFiles = files.filter(f => {
    const p = f.split(path.sep).join("/");
    return p.startsWith("apps/nexus-bi-app/components/") && (p.endsWith(".tsx") || p.endsWith(".ts"));
  });

  const contents = new Map();
  for (const file of files) {
    const p = file.split(path.sep).join("/");
    if (!p.startsWith("apps/nexus-bi-app/") || !(p.endsWith(".ts") || p.endsWith(".tsx"))) continue;
    try {
      contents.set(p, await fs.readFile(file, "utf8"));
    } catch {
      // ignore unreadable file
    }
  }

  const orphans = [];

  for (const componentFile of appFiles) {
    const baseName = path.basename(componentFile).replace(/\.tsx?$/, "");
    let referenced = false;

    for (const [otherPath, content] of contents.entries()) {
      if (otherPath === componentFile) continue;
      if (content.includes(baseName)) {
        referenced = true;
        break;
      }
    }

    if (!referenced) orphans.push(componentFile.split(path.sep).join("/"));
  }

  return orphans;
}

async function scanForSecrets(files) {
  const hits = [];

  for (const file of files) {
    const ext = path.extname(file);
    if (!TEXT_EXTENSIONS.has(ext)) continue;

    let content;
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }

    for (const { name, regex } of SECRET_PATTERNS) {
      if (regex.test(content)) {
        hits.push({ file: file.split(path.sep).join("/"), pattern: name });
      }
    }
  }

  return hits;
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const str = Array.isArray(value) ? value.join("|") : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function writeCsv(filePath, rows) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  if (!rows.length) {
    await fs.writeFile(filePath, "", "utf8");
    return;
  }
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(","), ...rows.map(row => headers.map(h => csvEscape(row[h])).join(","))].join("\n");
  await fs.writeFile(filePath, csv, "utf8");
}

export async function auditProjectStructure() {
  console.log("=== Auditoría de estructura del proyecto ===");

  const { files, dirsScanned } = await walk(ROOT);
  console.log(`Archivos escaneados: ${files.length}`);
  console.log(`Directorios escaneados: ${dirsScanned}`);

  const scripts = await readPackageScripts();
  const orphanPipelineScripts = findOrphanPipelineScripts(files, scripts);
  const orphanAppFiles = await findOrphanAppFiles(files);
  const secretHits = await scanForSecrets(files);

  const inventory = [];
  const filesByCategory = {};
  let sourceCount = 0;
  let generatedCount = 0;
  let docsCount = 0;
  let appFilesCount = 0;
  let pipelineFilesCount = 0;
  let largeFilesCount = 0;

  for (const file of files) {
    const relPath = file.split(path.sep).join("/");
    let sizeBytes = 0;
    try {
      sizeBytes = (await fs.stat(file)).size;
    } catch {
      sizeBytes = 0;
    }

    const classification = classify(relPath);
    const io = PIPELINE_IO[relPath] || { consumed_by: [], produces: [] };
    const isOrphan = orphanPipelineScripts.includes(relPath) || orphanAppFiles.includes(relPath);

    filesByCategory[classification.category] = (filesByCategory[classification.category] || 0) + 1;

    if (classification.source_or_generated === "SOURCE" || classification.source_or_generated === "CONFIG" || classification.source_or_generated === "TEMPLATE" || classification.source_or_generated === "DOC") sourceCount += 1;
    if (classification.source_or_generated === "GENERATED" || classification.source_or_generated === "REPORT") generatedCount += 1;
    if (classification.type === "documentación") docsCount += 1;
    if (relPath.startsWith("apps/nexus-bi-app/")) appFilesCount += 1;
    if (relPath.startsWith("src/")) pipelineFilesCount += 1;
    if (sizeBytes > LARGE_FILE_BYTES) largeFilesCount += 1;

    inventory.push({
      path: relPath,
      extension: path.extname(relPath),
      size_bytes: sizeBytes,
      category: classification.category,
      type: classification.type,
      source_or_generated: classification.source_or_generated,
      should_version: classification.should_version,
      responsibility: classification.responsibility,
      consumed_by: io.consumed_by,
      produces: io.produces,
      risk: classification.risk,
      notes: isOrphan ? "Posible huérfano - ver docs/PROJECT_CLEANUP_CANDIDATES.md" : ""
    });
  }

  inventory.sort((a, b) => a.path.localeCompare(b.path));

  await fs.mkdir("data/reports", { recursive: true });
  await fs.writeFile(OUTPUT_JSON, JSON.stringify(inventory, null, 2), "utf8");
  await writeCsv(OUTPUT_CSV, inventory);

  const possibleOrphansCount = orphanPipelineScripts.length + orphanAppFiles.length;

  let status = "OK";
  if (possibleOrphansCount > 0 || secretHits.length > 0) status = "OK_WITH_WARNINGS";
  if (secretHits.length > 0 && secretHits.some(h => h.pattern === "AWS_ACCESS_KEY_ID")) status = "NEEDS_REVIEW";

  const summary = {
    generated_at: new Date().toISOString(),
    total_files_scanned: files.length,
    total_dirs_scanned: dirsScanned,
    excluded_dirs: Array.from(EXCLUDED_DIRS).concat(EXCLUDED_PATH_PREFIXES, Array.from(EXCLUDED_EXTENSIONS)),
    files_by_category: filesByCategory,
    source_files_count: sourceCount,
    generated_files_count: generatedCount,
    docs_count: docsCount,
    app_files_count: appFilesCount,
    pipeline_files_count: pipelineFilesCount,
    possible_orphans_count: possibleOrphansCount,
    possible_orphans: [...orphanPipelineScripts, ...orphanAppFiles],
    large_files_count: largeFilesCount,
    possible_secret_hits_count: secretHits.length,
    possible_secret_hits: secretHits,
    status
  };

  await fs.writeFile(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");

  console.log(JSON.stringify({ ...summary, possible_secret_hits: `${secretHits.length} hit(s) - ver ${SUMMARY_FILE}, nunca se imprime el valor` }, null, 2));
  console.log(`Inventario guardado en ${OUTPUT_JSON} y ${OUTPUT_CSV}`);
  console.log(`Resumen guardado en ${SUMMARY_FILE}`);
  console.log(`=== Auditoría de estructura: ${status} ===`);

  return summary;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  auditProjectStructure().catch(error => {
    console.error("ERROR AUDITANDO ESTRUCTURA DEL PROYECTO:");
    console.error(error);
    process.exit(1);
  });
}
