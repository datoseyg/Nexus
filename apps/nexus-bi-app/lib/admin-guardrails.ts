import { quoteIdentifier } from "./sql-guardrails";

// Whitelist separado de sql-guardrails.ts (que se mantiene sin tocar,
// scopeado a processed/marts/gold de solo lectura para el explorador
// genérico). Este es el que usan las rutas CRUD nuevas (app/api/admin/**)
// - tener dos whitelists distintos es lo que hace cumplir en código "no
// CRUD sobre processed/marts/gold", no solo por convención de dónde vive
// cada route.ts.
const ADMIN_TABLES = {
  manual_review: ["part_aliases", "ticket_link_overrides"],
  stock: ["stock_movements"],
  audit: ["pipeline_runs", "data_quality_events"]
} as const;

export type AdminSchema = keyof typeof ADMIN_TABLES;

export function isAdminSchema(schema: string): schema is AdminSchema {
  return Object.prototype.hasOwnProperty.call(ADMIN_TABLES, schema);
}

export function assertAdminTable(schema: string, table: string): asserts schema is AdminSchema {
  if (!isAdminSchema(schema)) {
    throw new Error(
      `Schema no permitido para CRUD: "${schema}" — solo audit/manual_review/stock. ` +
      "processed/marts/gold son de solo lectura (ver app/api/tables/[schema]/[table] para explorarlas)."
    );
  }

  if (!(ADMIN_TABLES[schema] as readonly string[]).includes(table)) {
    throw new Error(`Tabla no permitida para CRUD: "${schema}"."${table}"`);
  }
}

export function quoteQualifiedAdminTable(schema: string, table: string): string {
  assertAdminTable(schema, table);
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}
