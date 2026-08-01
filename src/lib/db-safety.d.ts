// Declaraciones TypeScript para src/lib/db-safety.js (ETAPA SAFETY-1).
// Describe exactamente los exports reales del módulo -sin `any`, sin
// `@ts-ignore`- para que los importadores tipados (test/after-hours/
// *.integration.test.ts) dejen de depender de un `any` implícito (TS7016).
// No se importa el tipo `Pool`/`PoolClient` de "pg" a propósito: los
// callers reales (integration tests) ya pasan una instancia real de
// `pg.Pool`, y su método `query(sql: string)` es estructuralmente
// compatible con `QueryableClient` de abajo sin acoplar este archivo al
// paquete "pg".

export const PROTECTED_DATABASE_NAMES: ReadonlySet<string>;

export interface ConnectionTarget {
  host: string;
  port: string;
  database: string;
  user: string;
}

export function describeConnectionTarget(connectionString: string): ConnectionTarget;

export interface EvaluateDisposableTargetParams {
  databaseComment: string | null;
  expectedRunId: string;
  currentUser: string | undefined;
  expectedUser: string | undefined;
  databaseName: string | undefined;
  protectedDatabaseNames: ReadonlySet<string> | undefined;
  applicationName: string | undefined;
  expectedSuiteId: string;
  host: string | undefined;
}

export type DisposableTargetEvaluation = { ok: true } | { ok: false; reason: string };

export function evaluateDisposableTarget(params: EvaluateDisposableTargetParams): DisposableTargetEvaluation;

export class DisposableGuardError extends Error {
  constructor(reason: string);
}

export interface QueryableClient {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface AssertDisposableTargetOptions {
  expectedRunId: string;
  expectedUser?: string;
  expectedSuiteId: string;
  host?: string;
  protectedDatabaseNames?: ReadonlySet<string>;
}

export function assertDisposableTarget(pool: QueryableClient, opts: AssertDisposableTargetOptions): Promise<void>;

export function isLikelyDisposableName(databaseName: string | null | undefined): boolean;

export class WriteConfirmationRequiredError extends Error {
  constructor(reason: string);
}

export interface PreflightContext {
  environment?: string;
  applicationName?: string;
}

export function printConnectionPreflight(connectionString: string, ctx?: PreflightContext): ConnectionTarget;

export function buildWriteConfirmationToken(target: Pick<ConnectionTarget, "host" | "port" | "database">): string;

export interface AssertWriteConfirmedOptions {
  confirmationEnvVarName?: string;
  protectedConfirmationEnvVarName?: string;
  allowProtectedWithDualConfirmation?: boolean;
  environment?: string;
  applicationName?: string;
}

export function assertWriteConfirmed(connectionString: string, opts?: AssertWriteConfirmedOptions): ConnectionTarget;

export function isSupabaseCloudHost(host: string | null | undefined): boolean;

export function parseSupabaseProjectRef(target: Pick<ConnectionTarget, "host" | "user">): string | null;

export class UnknownSupabaseProjectError extends Error {
  constructor(reason: string);
}

export interface AssertKnownSupabaseProjectOptions {
  expectedProjectRefEnvVar?: string;
}

export function assertKnownSupabaseProject(connectionString: string, opts?: AssertKnownSupabaseProjectOptions): ConnectionTarget;

export function seedDisposableMarker(pool: QueryableClient, runId: string): Promise<void>;
