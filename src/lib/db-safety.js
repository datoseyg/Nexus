// ETAPA SAFETY-1 - Endurecimiento de aislamiento Postgres. Todos los tests
// de integración y cualquier escritura fuera de un target explícitamente
// confirmado deben pasar por acá. Origen: un incidente real -una suite de
// integración corrió contra nexus-afterhours-realdata2 (contenedor de
// revisión del usuario) porque el único guard existente en 5 archivos
// distintos era `{skip: !TEST_DB_URL}`, que solo verifica que la variable
// exista, nunca A QUÉ apunta. Ver investigación completa en el reporte de
// ETAPA SAFETY-1.

// Lista explícita de nombres de base que NUNCA pueden recibir una escritura
// de test/fixture, independientemente del puerto (§4: "no depender
// exclusivamente del puerto"). Extenderla es una decisión humana, nunca
// automática.
export const PROTECTED_DATABASE_NAMES = new Set([
  "nexus_afterhours_realdata", // nexus-afterhours-realdata2, contenedor de revisión del usuario
  "postgres" // base por defecto de cualquier servidor Postgres, incluida Supabase cloud
]);

// Prefijo de host que identifica Supabase cloud -cualquier host que termine
// así se trata como protegido sin excepción, sin importar el nombre de base.
const SUPABASE_CLOUD_HOST_SUFFIXES = [".supabase.co", ".supabase.com"];

export function isSupabaseCloudHost(host) {
  const normalizedHost = String(host ?? "").toLowerCase().replace(/\.$/, "");
  return SUPABASE_CLOUD_HOST_SUFFIXES.some(suffix => normalizedHost.endsWith(suffix));
}

const MARKER_PATTERN = /^DISPOSABLE_TEST:(.+)$/;

/**
 * Extrae host/puerto/base/usuario de un connection string SIN exponer la
 * contraseña -seguro de imprimir en logs/consola (§6: preflight visible).
 * @param {string} connectionString
 * @returns {{ host: string, port: string, database: string, user: string }}
 */
export function describeConnectionTarget(connectionString) {
  const url = new URL(connectionString);
  return {
    host: url.hostname,
    port: url.port || "5432",
    database: url.pathname.replace(/^\//, ""),
    user: decodeURIComponent(url.username || "")
  };
}

/**
 * Lógica de decisión PURA -sin tocar la base. Recibe valores ya
 * consultados (comentario de la base, usuario actual, etc.) y decide si el
 * target es seguro para fixtures/tests. Nunca se llama directamente desde
 * un test -usar assertDisposableTarget(), que hace las consultas reales.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function evaluateDisposableTarget({
  databaseComment,
  expectedRunId,
  currentUser,
  expectedUser,
  databaseName,
  protectedDatabaseNames,
  applicationName,
  expectedSuiteId,
  host
}) {
  const protectedNames = protectedDatabaseNames ?? PROTECTED_DATABASE_NAMES;

  // 1) Entornos protegidos -nunca depende solo del marker; un marker falso
  // sembrado por error o con mala intención no puede vencer esta lista.
  if (protectedNames.has(databaseName)) {
    return { ok: false, reason: `ABORT: "${databaseName}" está en la lista de entornos protegidos -nunca recibe fixtures, sin excepción` };
  }
  if (isSupabaseCloudHost(host)) {
    return { ok: false, reason: `ABORT: host "${host}" es Supabase cloud -nunca recibe fixtures` };
  }

  // 2) Marca DISPOSABLE_TEST -debe existir y tener el formato exacto
  // sembrado por seedDisposableMarker() durante el bootstrap. Un test NUNCA
  // puede crear esta marca después de conectarse (ver seedDisposableMarker).
  const match = databaseComment ? MARKER_PATTERN.exec(databaseComment) : null;
  if (!match) {
    return { ok: false, reason: `ABORT: "${databaseName}" no tiene la marca DISPOSABLE_TEST -destino no verificado como desechable` };
  }

  // 3) run_id -evita que una marca vieja de una base desechable anterior
  // (puerto/nombre reutilizado) se acepte para una corrida distinta.
  const storedRunId = match[1];
  if (storedRunId !== expectedRunId) {
    return { ok: false, reason: `ABORT: run_id no coincide (esperado "${expectedRunId}", encontrado "${storedRunId}") -la marca pertenece a otra corrida` };
  }

  // 4) Rol de integración esperado.
  if (expectedUser && currentUser !== expectedUser) {
    return { ok: false, reason: `ABORT: usuario conectado "${currentUser}" no es el rol de integración esperado "${expectedUser}"` };
  }

  // 5) application_name -debe identificar la suite y el run_id (§ application_name).
  if (!applicationName || !applicationName.startsWith(`${expectedSuiteId}:`)) {
    return { ok: false, reason: `ABORT: application_name ("${applicationName ?? ""}") no identifica la suite esperada "${expectedSuiteId}"` };
  }

  return { ok: true };
}

/**
 * Error dedicado -permite a los callers distinguir "el guard rechazó el
 * target" de cualquier otro error de conexión/query.
 */
export class DisposableGuardError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "DisposableGuardError";
  }
}

/**
 * Wrapper real: consulta Postgres y aplica evaluateDisposableTarget().
 * Lanza DisposableGuardError si el target no es seguro -debe llamarse ANTES
 * de cualquier otra sentencia (DDL/DML) del test, como PRIMERA operación
 * tras conectar.
 * @param {import("pg").Pool | import("pg").PoolClient} pool
 * @param {{ expectedRunId: string, expectedUser?: string, expectedSuiteId: string, host?: string, protectedDatabaseNames?: Set<string> }} opts
 */
export async function assertDisposableTarget(pool, opts) {
  const [commentRes, userRes, dbRes, appNameRes] = await Promise.all([
    pool.query(`SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = current_database()`),
    pool.query(`SELECT current_user AS u`),
    pool.query(`SELECT current_database() AS db`),
    pool.query(`SHOW application_name`)
  ]);

  const result = evaluateDisposableTarget({
    databaseComment: commentRes.rows[0]?.comment ?? null,
    expectedRunId: opts.expectedRunId,
    currentUser: userRes.rows[0]?.u,
    expectedUser: opts.expectedUser,
    databaseName: dbRes.rows[0]?.db,
    protectedDatabaseNames: opts.protectedDatabaseNames,
    applicationName: appNameRes.rows[0]?.application_name,
    expectedSuiteId: opts.expectedSuiteId,
    host: opts.host
  });

  if (!result.ok) {
    throw new DisposableGuardError(result.reason);
  }
}

// §6 - guardas para comandos productivos (--apply). Un nombre de base que
// "parece" desechable (sufijo _test/_disposable) puede escribirse sin
// confirmación extra. Cualquier otro nombre -incluida cualquier base real
// desconocida- exige una confirmación EXPLÍCITA que nombre el target exacto
// (nunca una bandera genérica tipo ALLOW_WRITE=true). Los nombres en
// PROTECTED_DATABASE_NAMES o el host de Supabase cloud NUNCA se habilitan
// en esta etapa, ni siquiera con confirmación -ver §9 del encargo ("no
// habilites escrituras productivas durante esta etapa").
const LIKELY_DISPOSABLE_NAME_PATTERN = /(_test\d*|_disposable\d*)(_|$)/i;

export function isLikelyDisposableName(databaseName) {
  return LIKELY_DISPOSABLE_NAME_PATTERN.test(databaseName ?? "");
}

export class WriteConfirmationRequiredError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "WriteConfirmationRequiredError";
  }
}

/**
 * Imprime el destino completo (sin credenciales) -SIEMPRE, antes de
 * cualquier posible escritura. Return value reutilizable por el caller
 * para logging adicional.
 * @param {string} connectionString
 * @param {{ environment?: string, applicationName?: string }} [ctx]
 */
export function printConnectionPreflight(connectionString, ctx = {}) {
  const target = describeConnectionTarget(connectionString);
  // eslint-disable-next-line no-console
  console.log(
    `[preflight] host=${target.host} port=${target.port} database=${target.database} user=${target.user} ` +
    `environment=${ctx.environment ?? "UNKNOWN"} application_name=${ctx.applicationName ?? "(sin setear)"}`
  );
  return target;
}

/**
 * Token de confirmación derivado de host+puerto+base -nunca solo el nombre
 * de la base. Cambiar CUALQUIERA de los tres invalida una confirmación ya
 * dada (ej. reusar el mismo nombre de base en un host distinto por error
 * ya no "hereda" una confirmación anterior).
 * @param {{ host: string, port: string, database: string }} target
 */
export function buildWriteConfirmationToken(target) {
  return `${target.host}:${target.port}/${target.database}`;
}

/**
 * Exige confirmación explícita para escribir contra un target que no
 * "parece" desechable. Lanza WriteConfirmationRequiredError sin ejecutar
 * ninguna sentencia si la confirmación falta o no coincide EXACTO con
 * host+puerto+base -nunca acepta una bandera genérica, y nunca solo el
 * nombre de la base (un mismo nombre en un host distinto NO reutiliza la
 * confirmación).
 *
 * Por defecto, un target protegido (PROTECTED_DATABASE_NAMES o host
 * Supabase cloud) queda bloqueado SIN excepción -ninguna confirmación lo
 * habilita. `allowProtectedWithDualConfirmation` es un opt-in EXPLÍCITO por
 * caller (nunca implícito, nunca una env var global) para el único caso que
 * lo necesita (migrate-to-supabase.js, cuyo destino real SIEMPRE es
 * protegido -sin esto el script quedaría permanentemente inutilizable).
 * Con el opt-in activo, escribir contra el target protegido exige DOS
 * tokens simultáneos -CONFIRM_WRITE_TARGET Y CONFIRM_PROTECTED_WRITE_TARGET-
 * cada uno host:puerto/base EXACTOS del destino efectivo; cualquiera
 * ausente, distinto entre sí, o apuntando a otro host/puerto/base aborta
 * antes de ejecutar nada.
 * @param {string} connectionString
 * @param {{ confirmationEnvVarName?: string, protectedConfirmationEnvVarName?: string, allowProtectedWithDualConfirmation?: boolean, environment?: string, applicationName?: string }} [opts]
 */
export function assertWriteConfirmed(connectionString, opts = {}) {
  const confirmationEnvVarName = opts.confirmationEnvVarName ?? "CONFIRM_WRITE_TARGET";
  const target = printConnectionPreflight(connectionString, opts);

  if (PROTECTED_DATABASE_NAMES.has(target.database) || isSupabaseCloudHost(target.host)) {
    if (!opts.allowProtectedWithDualConfirmation) {
      throw new WriteConfirmationRequiredError(
        `ABORT: "${target.database}"@"${target.host}" es un entorno protegido -escrituras productivas contra este destino no están habilitadas en esta etapa, ninguna confirmación las autoriza.`
      );
    }

    const protectedConfirmationEnvVarName = opts.protectedConfirmationEnvVarName ?? "CONFIRM_PROTECTED_WRITE_TARGET";
    const expectedToken = buildWriteConfirmationToken(target);
    const confirmation = process.env[confirmationEnvVarName];
    const protectedConfirmation = process.env[protectedConfirmationEnvVarName];

    if (confirmation !== expectedToken || protectedConfirmation !== expectedToken) {
      throw new WriteConfirmationRequiredError(
        `ABORT: "${target.database}"@"${target.host}:${target.port}" es un entorno protegido -requiere AMBAS ${confirmationEnvVarName}="${expectedToken}" Y ${protectedConfirmationEnvVarName}="${expectedToken}" simultáneamente (host:puerto/base EXACTOS del destino efectivo, no una bandera genérica). Una confirmación para otro host, puerto o base no es válida. No se ejecutó ninguna escritura.`
      );
    }

    return target;
  }

  if (isLikelyDisposableName(target.database)) {
    return target; // nombre de base ya se autoidentifica como desechable, sin fricción adicional
  }

  const expectedToken = buildWriteConfirmationToken(target);
  const confirmation = process.env[confirmationEnvVarName];
  if (confirmation !== expectedToken) {
    throw new WriteConfirmationRequiredError(
      `ABORT: "${target.database}"@"${target.host}:${target.port}" no se reconoce como desechable (sin sufijo _test/_disposable) -para escribir ahí se requiere ${confirmationEnvVarName}="${expectedToken}" (host:puerto/base EXACTOS, no una bandera genérica ni solo el nombre de la base). No se ejecutó ninguna escritura.`
    );
  }

  return target;
}

// NEXUS V3 - Protección Nexus V2/V3 (mecanismo de actualización de datos).
// isSupabaseCloudHost/PROTECTED_DATABASE_NAMES distinguen únicamente "¿es
// Supabase cloud?" -nunca "¿CUÁL proyecto Supabase?". Nexus V2 (producción
// actual) y Nexus V3 (este trabajo) son dos proyectos Supabase DISTINTOS que
// terminan en el MISMO sufijo de host (.supabase.co), así que
// assertWriteConfirmed por sí solo no basta para evitar que una connection
// string mal copiada (apuntando por error al proyecto V2) pase sus dos
// tokens de confirmación igual -los tokens confirman host:puerto/base, no
// identidad de proyecto.
const DIRECT_HOST_PROJECT_REF_PATTERN = /^db\.([a-z0-9]+)\.supabase\.co$/i;
// Convención real de Supabase para el pooler compartido (IPv4 fallback,
// mismo host para todos los proyectos de una región): el project ref viaja
// en el USUARIO ("postgres.<project-ref>"), nunca en el host.
const POOLER_USER_PROJECT_REF_PATTERN = /^[^.]+\.([a-z0-9]+)$/;

/**
 * Extrae el project ref de un destino Supabase cloud, desde el host
 * (conexión directa) o desde el usuario (pooler compartido) -nunca asume
 * uno u otro, intenta ambos patrones reales documentados en
 * docs/RUNBOOK_SUPABASE_NETLIFY.md.
 * @param {{ host: string, user: string }} target
 * @returns {string | null}
 */
export function parseSupabaseProjectRef(target) {
  const directMatch = DIRECT_HOST_PROJECT_REF_PATTERN.exec(String(target?.host ?? "").toLowerCase());
  if (directMatch) return directMatch[1];
  if (isSupabaseCloudHost(target?.host)) {
    const poolerMatch = POOLER_USER_PROJECT_REF_PATTERN.exec(String(target?.user ?? ""));
    if (poolerMatch) return poolerMatch[1];
  }
  return null;
}

export class UnknownSupabaseProjectError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "UnknownSupabaseProjectError";
  }
}

/**
 * Capa ADICIONAL sobre assertWriteConfirmed, nunca un reemplazo -se llama
 * DESPUÉS de que assertWriteConfirmed ya exigió sus tokens de confirmación.
 * Exige que el project ref resuelto del destino coincida EXACTO con
 * process.env[expectedProjectRefEnvVar] (SUPABASE_PROJECT_REF_V3 por
 * defecto) -así una connection string que por error apunte al proyecto
 * Nexus V2 (mismo sufijo .supabase.co, tokens de confirmación igual de
 * "válidos" en forma) queda bloqueada por identidad de proyecto, no solo
 * por host:puerto/base. Nunca aplica a un destino que no sea Supabase cloud
 * (local desechable, etc.) -esta capa es específicamente sobre distinguir
 * proyectos Supabase entre sí.
 * @param {string} connectionString
 * @param {{ expectedProjectRefEnvVar?: string }} [opts]
 * @returns {{ host: string, port: string, database: string, user: string }}
 */
export function assertKnownSupabaseProject(connectionString, opts = {}) {
  const expectedProjectRefEnvVar = opts.expectedProjectRefEnvVar ?? "SUPABASE_PROJECT_REF_V3";
  const target = describeConnectionTarget(connectionString);

  if (!isSupabaseCloudHost(target.host)) {
    return target;
  }

  const expectedRef = process.env[expectedProjectRefEnvVar];
  if (!expectedRef) {
    throw new UnknownSupabaseProjectError(
      `ABORT: falta ${expectedProjectRefEnvVar} en el entorno -no se puede confirmar que "${target.host}" sea el proyecto Supabase V3 esperado, nunca se asume por defecto.`
    );
  }

  const actualRef = parseSupabaseProjectRef(target);
  if (!actualRef) {
    throw new UnknownSupabaseProjectError(
      `ABORT: no se pudo extraer el project ref de host "${target.host}"/usuario "${target.user}" -formato de conexión Supabase no reconocido, nunca se asume que es el proyecto correcto.`
    );
  }

  if (actualRef !== expectedRef) {
    throw new UnknownSupabaseProjectError(
      `ABORT: el project ref del destino ("${actualRef}") no coincide con ${expectedProjectRefEnvVar} ("${expectedRef}") -este destino podría ser Nexus V2 u otro proyecto Supabase; nunca se escribe ahí sin la confirmación exacta de proyecto.`
    );
  }

  return target;
}

/**
 * Política ÚNICA para cualquier escritura V3 que pueda alcanzar un destino
 * Supabase cloud -combina, en orden, las dos capas ya existentes: primero
 * assertWriteConfirmed con el opt-in de doble confirmación (exige AMBOS
 * CONFIRM_WRITE_TARGET y CONFIRM_PROTECTED_WRITE_TARGET, host:puerto/base
 * EXACTOS del destino efectivo), después assertKnownSupabaseProject (el
 * project ref real del destino debe coincidir EXACTO con
 * SUPABASE_PROJECT_REF_V3, o la variable que indique
 * opts.expectedProjectRefEnvVar). Ningún caller debe volver a componer esta
 * combinación a mano -cada write path hacia Supabase (migrate-to-supabase.js,
 * contracts, holidays, working-hours, contract-rematch) reutiliza esta
 * única función, así que fortalecer la política en un solo lugar fortalece
 * a TODOS los callers a la vez, y es estructuralmente imposible configurar
 * un URL Supabase equivocado, poner correctamente ambos tokens de
 * confirmación, y aun así escribir -el project ref real también debe
 * coincidir.
 *
 * Un destino no-Supabase (local desechable, etc.) sigue las reglas locales
 * existentes sin cambios: assertWriteConfirmed no exige nada especial fuera
 * de PROTECTED_DATABASE_NAMES/host Supabase, y assertKnownSupabaseProject
 * no-opea para un host no-Supabase.
 * @param {string} connectionString
 * @param {{ environment?: string, applicationName?: string, expectedProjectRefEnvVar?: string }} [opts]
 * @returns {{ host: string, port: string, database: string, user: string }}
 */
export function assertSupabaseWriteAuthorized(connectionString, opts = {}) {
  const target = assertWriteConfirmed(connectionString, {
    environment: opts.environment,
    applicationName: opts.applicationName,
    allowProtectedWithDualConfirmation: true
  });
  assertKnownSupabaseProject(connectionString, { expectedProjectRefEnvVar: opts.expectedProjectRefEnvVar });
  return target;
}

/**
 * Siembra la marca DISPOSABLE_TEST -SOLO debe invocarse desde un script de
 * bootstrap que crea la base desechable, NUNCA desde el before() de un
 * test (si el test pudiera crear su propia marca, un test accidentalmente
 * apuntado a un target real simplemente se auto-aprobaría, anulando todo
 * el propósito del guard).
 * @param {import("pg").Pool | import("pg").PoolClient} pool
 * @param {string} runId
 */
export async function seedDisposableMarker(pool, runId) {
  const dbRes = await pool.query(`SELECT current_database() AS db`);
  const dbName = dbRes.rows[0].db;
  // COMMENT ON DATABASE toma un identificador (nombre de base), no un
  // literal -se cita como identificador Postgres (comillas dobles,
  // duplicando cualquier comilla interna), nunca interpolación directa.
  const quotedDbName = `"${dbName.replace(/"/g, '""')}"`;
  // runId es generado por el propio bootstrap (uuid), nunca viene de input
  // externo -interpolación seguro para un literal de comentario simple;
  // igual se escapa cualquier comilla simple por defensa en profundidad.
  const escapedRunId = runId.replace(/'/g, "''");
  await pool.query(`COMMENT ON DATABASE ${quotedDbName} IS 'DISPOSABLE_TEST:${escapedRunId}'`);
}
