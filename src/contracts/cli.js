const EFFECTIVE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {string[]} argv proceso completo, ej. process.argv.slice(2)
 * @returns {{ file: string | null, effectiveDate: string | null, mode: 'dry-run' | 'apply' }}
 */
export function parseArgs(argv) {
  let file = null;
  let effectiveDate = null;
  let dryRunFlag = false;
  let applyFlag = false;

  for (const arg of argv) {
    if (arg.startsWith("--file=")) {
      file = arg.slice("--file=".length);
    } else if (arg.startsWith("--effective-date=")) {
      effectiveDate = arg.slice("--effective-date=".length);
    } else if (arg === "--dry-run") {
      dryRunFlag = true;
    } else if (arg === "--apply") {
      applyFlag = true;
    }
  }

  // Modo por defecto: dry-run (nunca --apply implícito).
  const mode = applyFlag && !dryRunFlag ? "apply" : "dry-run";

  return { file, effectiveDate, mode };
}

/**
 * @param {{ file: string | null, effectiveDate: string | null, mode: string }} args
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateArgs(args) {
  if (!args.file) {
    return { ok: false, reason: "Falta --file=<ruta al CSV fuente>." };
  }

  if (args.effectiveDate && !EFFECTIVE_DATE_PATTERN.test(args.effectiveDate)) {
    return { ok: false, reason: `--effective-date debe tener formato YYYY-MM-DD, recibido "${args.effectiveDate}".` };
  }

  if (args.mode === "apply" && !args.effectiveDate) {
    return { ok: false, reason: "--apply requiere --effective-date=YYYY-MM-DD (el dry-run puede correr sin ella)." };
  }

  return { ok: true };
}
