const SUBCOMMANDS = Object.freeze(["validate", "dry-run", "apply", "publish"]);

/**
 * @param {string[]} argv ej. process.argv.slice(2)
 * @returns {{
 *   subcommand: string|null,
 *   file: string|null,
 *   confirm: boolean,
 *   coverageId: string|null,
 *   supersedeCoverageId: string|null
 * }}
 */
export function parseArgs(argv) {
  const [maybeSubcommand, ...rest] = argv;
  const subcommand = SUBCOMMANDS.includes(maybeSubcommand) ? maybeSubcommand : null;

  let file = null;
  let confirm = false;
  let coverageId = null;
  let supersedeCoverageId = null;

  for (const arg of rest) {
    if (arg.startsWith("--file=")) file = arg.slice("--file=".length);
    else if (arg === "--confirm") confirm = true;
    else if (arg.startsWith("--coverage-id=")) coverageId = arg.slice("--coverage-id=".length);
    else if (arg.startsWith("--supersede-coverage-id=")) supersedeCoverageId = arg.slice("--supersede-coverage-id=".length);
  }

  return { subcommand, file, confirm, coverageId, supersedeCoverageId };
}

/**
 * Seguro por defecto: sin subcomando reconocido, sin --file donde se
 * necesita, o sin --confirm explícito en apply -> inválido. Nunca hay un
 * "apply implícito" ni un "publish implícito".
 * @param {ReturnType<typeof parseArgs>} args
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateArgs(args) {
  if (!args.subcommand) {
    return { ok: false, reason: `Subcomando requerido: uno de ${SUBCOMMANDS.join(", ")}.` };
  }

  if (args.subcommand === "validate" || args.subcommand === "dry-run" || args.subcommand === "apply") {
    if (!args.file) {
      return { ok: false, reason: `--file=<ruta al bundle JSON> es obligatorio para "${args.subcommand}".` };
    }
  }

  if (args.subcommand === "apply" && !args.confirm) {
    return { ok: false, reason: "apply requiere --confirm explícito -nunca hay apply implícito." };
  }

  if (args.subcommand === "publish") {
    if (!args.coverageId) {
      return { ok: false, reason: "publish requiere --coverage-id=<id>." };
    }
    if (args.supersedeCoverageId && args.supersedeCoverageId === args.coverageId) {
      return { ok: false, reason: "--supersede-coverage-id no puede ser igual a --coverage-id." };
    }
  }

  return { ok: true };
}
