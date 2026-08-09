// NEXUS V3 - Puente mínimo POST /api/data-refresh/runs -> GitHub Actions
// workflow_dispatch (.github/workflows/data-refresh.yml), solo para
// executorType=GITHUB (STAGING/PRODUCTION). Nunca se llama para LOCAL (ese
// camino lo cubre scripts/pipeline/local-refresh-worker.mjs por polling,
// sin GitHub de por medio).
//
// Server-only: el token nunca se expone como NEXT_PUBLIC_*, nunca se
// devuelve en la respuesta HTTP ni se escribe en ningún log (solo el
// resultado ok/reason, nunca el header Authorization ni el token mismo).
//
// El refresh_run_id ya creado por pipeline.fn_start_refresh_run (antes de
// llamar acá) viaja como input `refresh_run_id` del workflow - correlación
// EXPLÍCITA además de la garantía implícita del índice único
// refresh_runs_one_active_per_environment (sql/101): scripts/pipeline/run-data-refresh.mjs
// verifica ese id contra lo que efectivamente reclama antes de ejecutar
// nada (ver checkRefreshRunClaimMatchesExpectation en ese archivo).
export interface DispatchDataRefreshWorkflowParams {
  environment: string;
  mode: string;
  confirmed: boolean;
  reason: string | null;
  refreshRunId: string;
}

export interface DispatchDataRefreshWorkflowResult {
  ok: boolean;
  reason?: string;
}

const DEFAULT_WORKFLOW_FILE = "data-refresh.yml";
const DEFAULT_REF = "main";

export async function dispatchDataRefreshWorkflow(
  params: DispatchDataRefreshWorkflowParams
): Promise<DispatchDataRefreshWorkflowResult> {
  const token = process.env.GITHUB_ACTIONS_DISPATCH_TOKEN;
  const owner = process.env.GITHUB_ACTIONS_DISPATCH_OWNER;
  const repo = process.env.GITHUB_ACTIONS_DISPATCH_REPO;
  const workflow = process.env.GITHUB_ACTIONS_DISPATCH_WORKFLOW || DEFAULT_WORKFLOW_FILE;
  const ref = process.env.GITHUB_ACTIONS_DISPATCH_REF || DEFAULT_REF;

  const missing = [
    !token && "GITHUB_ACTIONS_DISPATCH_TOKEN",
    !owner && "GITHUB_ACTIONS_DISPATCH_OWNER",
    !repo && "GITHUB_ACTIONS_DISPATCH_REPO"
  ].filter((name): name is string => Boolean(name));
  if (missing.length > 0) {
    return { ok: false, reason: `Falta configuración de dispatch en el entorno: ${missing.join(", ")}.` };
  }

  let response: Response;
  try {
    response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28"
        },
        body: JSON.stringify({
          ref,
          inputs: {
            environment: params.environment,
            mode: params.mode,
            confirmed: String(params.confirmed),
            reason: params.reason ?? "",
            refresh_run_id: params.refreshRunId
          }
        })
      }
    );
  } catch (error) {
    return {
      ok: false,
      reason: `Error de red al llamar a la API de GitHub Actions: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  if (response.status !== 204) {
    let bodyText = "";
    try {
      bodyText = (await response.text()).slice(0, 500);
    } catch {
      // sin cuerpo legible - se reporta solo el status.
    }
    return { ok: false, reason: `GitHub Actions respondió ${response.status}${bodyText ? `: ${bodyText}` : "."}` };
  }

  return { ok: true };
}
