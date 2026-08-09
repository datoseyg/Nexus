// Phase 4 dead-code removal: GET /api/dashboard/fieldbeat/detail (Phase 3
// §10, deuda transitoria), su FieldbeatReportsTab.tsx consumidor,
// lib/fieldbeat-query.ts y lib/fieldbeat-filter-state.ts se reemplazaron
// por la bandeja definitiva (/api/dashboard/fieldbeat/reports, ver
// lib/fieldbeat-reports-queries.ts) - parseFieldbeatFilters/
// buildFieldbeatMartConditions/buildFieldbeatOrigenSubquery/FieldbeatFilters
// se eliminaron con ellos (sin consumidores). Lo único que sobrevive es
// FieldbeatOrigen: sigue siendo el vocabulario de origen (APK/WEB) que
// lib/fieldbeat-quality-filters.ts reutiliza.
export type FieldbeatOrigen = "APK" | "WEB";
