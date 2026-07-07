// Cliente de datos para NEXT_PUBLIC_DATA_MODE=static (demo cloud read-only,
// ver docs/CLOUD_SMOKE_TEST.md). En este modo la app NO tiene warehouse
// DuckDB disponible (Cloudflare Pages solo sirve estáticos) - todo el dato
// viene de los JSON pre-generados por `npm run cloud:export-snapshot` en
// apps/nexus-bi-app/public/data/cloud/. Nunca debe hacer fetch a /api/*.

const CLOUD_DATA_BASE = "/data/cloud";

export class StaticSnapshotMissingError extends Error {
  constructor(fileName: string) {
    super(
      `No se encontró el snapshot estático "${fileName}" en ${CLOUD_DATA_BASE}/. ` +
      "Corré \"npm run cloud:export-snapshot\" antes de \"npm run app:build:static\"."
    );
    this.name = "StaticSnapshotMissingError";
  }
}

async function fetchCloudJson<T>(fileName: string): Promise<T> {
  const response = await fetch(`${CLOUD_DATA_BASE}/${fileName}`);
  if (!response.ok) throw new StaticSnapshotMissingError(fileName);
  return (await response.json()) as T;
}

export interface CloudSnapshotMetadata {
  generatedAt: string;
  dataMode: "static";
  sourceWarehouse: string;
  sanitized: boolean;
  files: string[];
}

export function getMetadata() {
  return fetchCloudJson<CloudSnapshotMetadata>("metadata.json");
}

export function getOperationalSummary() {
  return fetchCloudJson<Record<string, unknown>>("dashboard-operacional-summary.json");
}

export function getOperationalParts() {
  return fetchCloudJson<Record<string, unknown>>("dashboard-operacional-parts.json");
}

export function getAuditSummary() {
  return fetchCloudJson<Record<string, unknown>>("audit-summary.json");
}

export function getAuditManualReviewSample() {
  return fetchCloudJson<Record<string, unknown>>("audit-manual-review.sample.json");
}

export function getAfterHoursSummary() {
  return fetchCloudJson<Record<string, unknown>>("after-hours-summary.json");
}

// gold.equipment_part_lifecycle_summary es opcional en el warehouse -
// export-cloud-snapshot.js omite el archivo si la tabla no existe.
export async function getEquipmentLifecycleSummary() {
  try {
    return await fetchCloudJson<Record<string, unknown>>("equipment-lifecycle-summary.json");
  } catch (error) {
    if (error instanceof StaticSnapshotMissingError) return null;
    throw error;
  }
}

export function getScopeWarnings() {
  return fetchCloudJson<Record<string, unknown>>("scope-warnings.json");
}
