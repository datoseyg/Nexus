// Contratos del mecanismo de actualización manual de datos (pipeline.refresh_runs,
// sql/101_pipeline_refresh_runs.sql) - requisitos 1/2 del encargo NEXUS V3.

export type DataRefreshEnvironment = "LOCAL" | "STAGING" | "PRODUCTION";
export type DataRefreshMode = "INCREMENTAL" | "FULL";
export type DataRefreshExecutorType = "LOCAL" | "GITHUB";
export type DataRefreshStatus =
  | "QUEUED"
  | "CLAIMED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "PARTIAL_FAILED"
  | "CANCELLED"
  | "SUPERSEDED";

export interface DataRefreshRunSummary {
  refreshRunId: string;
  environment: DataRefreshEnvironment;
  mode: DataRefreshMode;
  executorType: DataRefreshExecutorType;
  status: DataRefreshStatus;
  requestedByRole: string | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastHeartbeatAt: string | null;
  currentStage: string | null;
  errorCode: string | null;
  errorSummary: string | null;
  validationStatus: string | null;
}

export interface DataRefreshRunStage {
  stageName: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
}

export interface DataRefreshRunDetail extends DataRefreshRunSummary {
  reason: string | null;
  sourcesRequested: string[] | null;
  sourcesCompleted: string[] | null;
  rowsExtracted: number | null;
  rowsLoaded: number | null;
  sourceSnapshotId: string | null;
  stages: DataRefreshRunStage[];
}

export interface DataRefreshDispatchOutcome {
  ok: boolean;
  reason?: string;
}

export interface DataRefreshStartResult {
  refreshRunId: string;
  status: "QUEUED" | "ALREADY_RUNNING";
  replay?: boolean;
  dispatch?: DataRefreshDispatchOutcome;
}
