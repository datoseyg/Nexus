// Adaptador de escritura hacia D1 - equivalente, para la capa GOLD "en
// vivo", de lo que R2StorageAdapter es para R2 (ver src/lib/storage.ts).
// Misma separacion de responsabilidades: este archivo no sabe que existen
// tablas GOLD concretas (Operational_Dashboard, etc.) - solo sabe como
// cargar de forma segura un array de objetos homogeneo en UNA tabla D1
// dada, cualquiera sea. Quien decide QUE cargar es el composition root
// (ver src/use-cases/build-gold.ts), nunca este modulo.
//
// Por que hace falta chunking: D1 ejecuta cada `batch()` como una unica
// llamada RPC al binding - un array de miles de D1PreparedStatement en una
// sola llamada arriesga superar el limite de tamaño de payload/numero de
// sentencias de D1 (los limites exactos varian por plan y version de la
// plataforma; en vez de asumir un numero y romper cuando Cloudflare lo
// ajuste, se particiona preventivamente en lotes chicos y configurables).

const DEFAULT_CHUNK_SIZE = 50;

export class D1LoadError extends Error {
  constructor(tableName: string, cause: unknown) {
    super(`No se pudo cargar la tabla "${tableName}" en D1: ${describeCause(cause)}`);
    this.name = "D1LoadError";
    this.cause = cause;
  }
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

// Comillas dobles estilo SQLite/D1 para identificadores (tabla o columna),
// escapando una comilla doble interna duplicandola. Los nombres que recibe
// este modulo siempre vienen del propio codigo (nombres de tabla GOLD
// fijos, columnas derivadas de Object.keys() de una fila GOLD) - nunca de
// input de usuario final - pero se cita igual: es la misma disciplina que
// csvEscape() en storage.ts, no cuesta nada y evita que un nombre de
// columna con un caracter inesperado rompa el SQL generado.
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

// D1 no acepta `undefined` ni `boolean` como parametro bindeado - se
// normalizan acá una sola vez en vez de exigirle a cada constructor GOLD
// que ya entregue tipos "D1-friendly".
function normalizeParam(value: unknown): string | number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "string") return value;
  return String(value);
}

function buildInsertOrReplaceSql(tableName: string, columns: string[]): string {
  const columnList = columns.map(quoteIdent).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  return `INSERT OR REPLACE INTO ${quoteIdent(tableName)} (${columnList}) VALUES (${placeholders})`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// Carga un array de filas GOLD en una tabla D1 ya existente (la creacion
// del esquema es responsabilidad de una migracion `wrangler d1
// migrations`, fuera del alcance de este loader - igual que WAREHOUSE
// database_id es hoy un placeholder en wrangler.toml pendiente de
// `wrangler d1 create`, ver ese archivo).
export class D1Loader {
  constructor(
    private readonly db: D1Database,
    private readonly chunkSize: number = DEFAULT_CHUNK_SIZE
  ) {}

  // Reemplaza el contenido COMPLETO de `tableName` por `rows` - GOLD es
  // una materializacion idempotente del estado actual (ver
  // build-gold.ts), nunca un log que se acumula: un cliente/ticket/equipo
  // que dejo de calificar para una tabla GOLD en esta corrida no debe
  // quedar huerfano en D1 de una corrida anterior.
  //
  // ATENCION - atomicidad parcial: `batch()` ejecuta cada CHUNK como una
  // unica transaccion implicita (si un statement del chunk falla, ESE
  // chunk se revierte entero), pero un DELETE+INSERTs de miles de filas
  // se particiona en VARIOS chunks/llamadas batch() independientes (ver
  // chunk() mas abajo). Esto significa que el reemplazo completo de una
  // tabla NO es atomico de punta a punta: si el chunk 3 de 10 falla, los
  // chunks 1-2 ya se comitearon. Se acepta este trade-off a proposito
  // porque D1 no ofrece transacciones multi-batch, y la alternativa
  // (una unica llamada batch() con TODAS las sentencias) arriesga
  // exceder los limites de tamaño/cantidad de D1 (ver comentario de
  // arriba). Un fallo a mitad de camino se relanza (D1LoadError) para que
  // el caller (queue-router.ts) haga `message.retry()` - un reintento
  // vuelve a correr replaceAll() desde cero, y como el primer statement de
  // TODO el conjunto siempre es el mismo DELETE, la tabla converge al
  // estado correcto sin quedar con una mezcla de filas viejas/nuevas de
  // forma permanente.
  async replaceAll(tableName: string, rows: Array<Record<string, unknown>>): Promise<void> {
    const deleteStatement = this.db.prepare(`DELETE FROM ${quoteIdent(tableName)}`);

    if (rows.length === 0) {
      await this.execChunk(tableName, [deleteStatement]);
      return;
    }

    const columns = Object.keys(rows[0]);
    const insertSql = buildInsertOrReplaceSql(tableName, columns);
    const insertStatements = rows.map(row =>
      this.db.prepare(insertSql).bind(...columns.map(column => normalizeParam(row[column])))
    );

    // El DELETE va primero en el PRIMER chunk (mismo batch() que sus
    // primeros inserts) - así el caso comun (una tabla que entra en un
    // solo chunk) sí queda atomico de punta a punta.
    const chunks = chunk([deleteStatement, ...insertStatements], this.chunkSize);

    for (const statements of chunks) {
      await this.execChunk(tableName, statements);
    }
  }

  private async execChunk(tableName: string, statements: D1PreparedStatement[]): Promise<void> {
    try {
      await this.db.batch(statements);
    } catch (cause) {
      throw new D1LoadError(tableName, cause);
    }
  }
}
