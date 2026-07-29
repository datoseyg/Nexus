// Utilidades compartidas de citado de identificadores y paginación,
// reutilizadas por rutas admin/audit/dashboard. Las funciones de
// descubrimiento dinámico de schema/tabla/columna vía information_schema
// (listTables/assertTableExists/getTableColumns/assertColumnExists/
// quoteQualifiedTable) se retiraron junto con el Explorador físico
// (app/api/tables/**, Gate B B23) - ese era su único consumidor. Ningún
// comando de corrección nuevo (sql/090+) las necesita: cada uno tiene sus
// columnas/tablas hardcodeadas en el cuerpo de su función PL/pgSQL, nunca
// resueltas dinámicamente desde un nombre que llegue del cliente.
export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
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
