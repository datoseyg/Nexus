// Parseo de argumentos del CLI `working-hours:build` / `working-hours:parity`
// -mismo patrón por subcomando que src/holidays/cli.js (SUBCOMMANDS +
// --confirm explícito para apply, nunca apply implícito). Ejecución real en
// build-working-hours.js; este módulo solo parsea/valida, sin tocar la base.

const SUBCOMMANDS = Object.freeze(["dry-run", "apply", "parity"]);
const PARITY_MODES = Object.freeze(["exact", "corrected", "both"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {string[]} argv ej. process.argv.slice(2)
 * @returns {{ subcommand: string|null, from: string|null, to: string|null, confirm: boolean, parityMode: string }}
 */
export function parseArgs(argv) {
  const [maybeSubcommand, ...rest] = argv;
  const subcommand = SUBCOMMANDS.includes(maybeSubcommand) ? maybeSubcommand : null;

  let from = null;
  let to = null;
  let confirm = false;
  let parityMode = "both";

  for (const arg of rest) {
    if (arg.startsWith("--from=")) from = arg.slice("--from=".length);
    else if (arg.startsWith("--to=")) to = arg.slice("--to=".length);
    else if (arg === "--confirm") confirm = true;
    else if (arg.startsWith("--parity-mode=")) parityMode = arg.slice("--parity-mode=".length);
  }

  return { subcommand, from, to, confirm, parityMode };
}

/**
 * Seguro por defecto: sin subcomando reconocido, o `apply` sin --confirm
 * explícito -> inválido. Nunca hay un "apply implícito".
 * @param {ReturnType<typeof parseArgs>} args
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateArgs(args) {
  if (!args.subcommand) {
    return { ok: false, reason: `Subcomando requerido: uno de ${SUBCOMMANDS.join(", ")}.` };
  }

  if (args.subcommand === "dry-run" || args.subcommand === "apply") {
    if (args.from && !DATE_PATTERN.test(args.from)) {
      return { ok: false, reason: `--from debe tener formato YYYY-MM-DD, recibido "${args.from}".` };
    }
    if (args.to && !DATE_PATTERN.test(args.to)) {
      return { ok: false, reason: `--to debe tener formato YYYY-MM-DD, recibido "${args.to}".` };
    }
    if (args.from && args.to && args.from > args.to) {
      return { ok: false, reason: "--from no puede ser posterior a --to." };
    }
  }

  if (args.subcommand === "apply" && !args.confirm) {
    return { ok: false, reason: "apply requiere --confirm explícito -nunca hay apply implícito." };
  }

  if (args.subcommand === "parity" && !PARITY_MODES.includes(args.parityMode)) {
    return { ok: false, reason: `--parity-mode debe ser uno de ${PARITY_MODES.join(", ")}, recibido "${args.parityMode}".` };
  }

  return { ok: true };
}

export { SUBCOMMANDS, PARITY_MODES };
