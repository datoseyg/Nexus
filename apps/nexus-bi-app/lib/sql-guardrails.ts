import { runQuery } from "./db";

// Identificadores (nombre de tabla/columna) no se pueden parametrizar en
// DuckDB - solo valores. Cada función acá valida el nombre contra
// information_schema ANTES de interpolarlo en SQL, y quoteIdentifier()
// escapa comillas dobles como defensa en profundidad adicional.
const ALLOWED_SCHEMAS = ["processed", "marts", "gold"] as const;
export type AllowedSchema = (typeof ALLOWED_SCHEMAS)[number];

export interface TableRef {
  table_schema: string;
  table_name: string;
}

export interface ColumnRef {
  name: string;
  type: string;
}

export function isAllowedSchema(schema: string): schema is AllowedSchema {
  return (ALLOWED_SCHEMAS as readonly string[]).includes(schema);
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function quoteQualifiedTable(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

export async function listTables(): Promise<TableRef[]> {
  return runQuery<TableRef>(
    `SELECT table_schema, table_name
     FROM information_schema.tables
     WHERE table_schema IN ('processed', 'marts', 'gold')
     ORDER BY table_schema, table_name`
  );
}

export async function assertTableExists(schema: string, table: string): Promise<void> {
  if (!isAllowedSchema(schema)) {
    throw new Error(`Schema no permitido: "${schema}"`);
  }

  const rows = await runQuery<{ n: bigint }>(
    `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
    [schema, table]
  );

  if (!rows.length || Number(rows[0].n) === 0) {
    throw new Error(`Tabla no encontrada: "${schema}"."${table}"`);
  }
}

export async function getTableColumns(schema: string, table: string): Promise<ColumnRef[]> {
  await assertTableExists(schema, table);

  const rows = await runQuery<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, table]
  );

  return rows.map(row => ({ name: row.column_name, type: row.data_type }));
}

export async function assertColumnExists(schema: string, table: string, column: string): Promise<ColumnRef[]> {
  const columns = await getTableColumns(schema, table);

  if (!columns.some(c => c.name === column)) {
    throw new Error(`Columna no encontrada: "${schema}"."${table}"."${column}"`);
  }

  return columns;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export function clampPageSize(requested: number | undefined | null): number {
  if (!requested || Number.isNaN(requested) || requested <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(requested), MAX_PAGE_SIZE);
}

export function clampPage(requested: number | undefined | null): number {
  if (!requested || Number.isNaN(requested) || requested < 1) return 1;
  return Math.floor(requested);
}
