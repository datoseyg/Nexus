// Parseo de argumentos del futuro CLI `working-hours:build` (implementación
// real del builder diferida a 6.6B2 -acá solo el parseo puro, mirror exacto
// de src/contracts/cli.js).

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {string[]} argv ej. process.argv.slice(2)
 * @returns {{ from: string|null, to: string|null, mode: 'dry-run'|'apply' }}
 */
export function parseArgs(argv) {
  let from = null;
  let to = null;
  let dryRunFlag = false;
  let applyFlag = false;

  for (const arg of argv) {
    if (arg.startsWith("--from=")) {
      from = arg.slice("--from=".length);
    } else if (arg.startsWith("--to=")) {
      to = arg.slice("--to=".length);
    } else if (arg === "--dry-run") {
      dryRunFlag = true;
    } else if (arg === "--apply") {
      applyFlag = true;
    }
  }

  const mode = applyFlag && !dryRunFlag ? "apply" : "dry-run";
  return { from, to, mode };
}

/**
 * @param {{ from: string|null, to: string|null, mode: string }} args
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateArgs(args) {
  if (args.from && !DATE_PATTERN.test(args.from)) {
    return { ok: false, reason: `--from debe tener formato YYYY-MM-DD, recibido "${args.from}".` };
  }
  if (args.to && !DATE_PATTERN.test(args.to)) {
    return { ok: false, reason: `--to debe tener formato YYYY-MM-DD, recibido "${args.to}".` };
  }
  if (args.from && args.to && args.from > args.to) {
    return { ok: false, reason: "--from no puede ser posterior a --to." };
  }
  if (args.mode === "apply" && !args.from && !args.to) {
    return { ok: false, reason: "--apply requiere al menos --from o --to (nunca un backfill total implícito sin acotar rango)." };
  }
  return { ok: true };
}
