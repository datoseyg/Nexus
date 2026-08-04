import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

function defaultRun(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

function supabaseEntrypoint(repoRoot) {
  return path.join(repoRoot, "node_modules", "supabase", "dist", "supabase.js");
}

function parseTomlValue(value) {
  const uncommented = value.replace(/\s+#.*$/, "").trim();
  if (/^".*"$/.test(uncommented)) return uncommented.slice(1, -1);
  if (/^(true|false)$/.test(uncommented)) return uncommented === "true";
  if (/^\d+$/.test(uncommented)) return Number(uncommented);
  return uncommented;
}

export function readSupabaseLocalConfig(contents) {
  let section = "root";
  const values = new Map();
  for (const line of contents.split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      section = header[1];
      continue;
    }
    const assignment = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!assignment || line.trimStart().startsWith("#")) continue;
    values.set(`${section}.${assignment[1]}`, parseTomlValue(assignment[2]));
  }

  const port = key => {
    const value = values.get(key);
    return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : null;
  };
  const apiPort = port("api.port");
  const dbPort = port("db.port");
  const studioPort = port("studio.port");
  const projectId = values.get("root.project_id");
  if (!apiPort || !dbPort || !studioPort || typeof projectId !== "string" || !projectId) {
    throw new Error("supabase/config.toml debe definir project_id y los puertos válidos de api, db y studio.");
  }

  const configuredPorts = [
    port("db.shadow_port"),
    apiPort,
    dbPort,
    studioPort,
    port("local_smtp.port"),
    port("local_smtp.smtp_port"),
    port("local_smtp.pop3_port"),
    port("analytics.port"),
    port("analytics.vector_port"),
    port("db.pooler.port")
  ].filter((value, index, all) => value && all.indexOf(value) === index).sort((a, b) => a - b);

  return {
    projectId,
    apiPort,
    dbPort,
    studioPort,
    apiUrl: `http://127.0.0.1:${apiPort}`,
    configuredPorts
  };
}

function readEnvValue(contents, name) {
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(new RegExp(`^\\s*${name}\\s*=\\s*(.*?)\\s*$`));
    if (match && !line.trimStart().startsWith("#")) {
      return match[1].replace(/^(?:"(.*)"|'(.*)')$/, "$1$2");
    }
  }
  return null;
}

export function resolveLocalAnalyticsDatabaseUrl(environment, envFileContents = "") {
  const value = environment.WORKING_HOURS_DB_URL ?? readEnvValue(envFileContents, "WORKING_HOURS_DB_URL");
  if (!value) throw new Error("Falta WORKING_HOURS_DB_URL para el PostgreSQL analítico local de Nexus.");
  const url = new URL(value);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error(`WORKING_HOURS_DB_URL debe apuntar a localhost; host recibido: ${url.hostname}.`);
  }
  return value;
}

export function buildNextEnvironment(apiUrl, analyticsDatabaseUrl, environment = process.env) {
  return {
    ...environment,
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    SUPABASE_DB_URL: analyticsDatabaseUrl,
    DATABASE_SSL_MODE: "disable"
  };
}

export function shouldUseShellForNpm(platform = process.platform) {
  return platform === "win32";
}

export function resolvePredevApiUrl(environment, envFileContents = "") {
  if (environment.NEXT_PUBLIC_SUPABASE_URL) return environment.NEXT_PUBLIC_SUPABASE_URL;
  const value = readEnvValue(envFileContents, "NEXT_PUBLIC_SUPABASE_URL");
  if (value) return value;
  throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL en el entorno y en apps/nexus-bi-app/.env.local.");
}

export function checkPortAvailability(port, host = "127.0.0.1") {
  return new Promise(resolve => {
    const server = createServer();
    server.unref();
    server.once("error", error => {
      const code = error.code;
      resolve({
        available: false,
        reason: code === "EADDRINUSE" ? "IN_USE" : code === "EACCES" ? "EXCLUDED" : "UNAVAILABLE"
      });
    });
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolve({ available: true }));
    });
  });
}

export async function isHttpServiceAvailable(url, {
  fetchImpl = fetch,
  timeoutMs = 1500
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForHttpService({
  url,
  timeoutMs = 60_000,
  pollIntervalMs = 500,
  probe = isHttpServiceAvailable,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now
}) {
  const deadline = now() + timeoutMs;
  do {
    if (await probe(url)) return true;
    await sleep(pollIntervalMs);
  } while (now() < deadline);
  return false;
}

function startFailureMessage(result, apiUrl) {
  if (result.error?.code === "ETIMEDOUT") {
    return "La CLI Supabase excedió su timeout limitado de 150 segundos. Revisa Docker y el health de los contenedores.";
  }
  const diagnostic = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  if (/ports are not available|access permissions|address already in use|bind:/i.test(diagnostic)) {
    return [
      `Supabase no pudo publicar el puerto local de ${apiUrl}.`,
      "El puerto está ocupado o reservado por Windows.",
      "Comprueba listeners y reservas con:",
      `  Get-NetTCPConnection -LocalPort ${new URL(apiUrl).port} -ErrorAction SilentlyContinue`,
      "  netsh interface ipv4 show excludedportrange protocol=tcp",
      "No uses `supabase db reset` ni `supabase stop --no-backup`."
    ].join("\n");
  }
  return "Supabase local no pudo iniciarse. Ejecuta la CLI local con `--debug` y revisa el health de los contenedores.";
}

export async function ensureLocalRuntime({
  repoRoot,
  exists = existsSync,
  readText = file => readFileSync(file, "utf8"),
  run = defaultRun,
  probeApi,
  waitForApi,
  checkPort = checkPortAvailability
}) {
  const configPath = path.join(repoRoot, "supabase", "config.toml");
  if (!exists(configPath)) {
    throw new Error(`Falta ${configPath}. Se aborta sin ejecutar supabase init.`);
  }

  const cli = supabaseEntrypoint(repoRoot);
  if (!exists(cli)) {
    throw new Error("Falta la CLI Supabase instalada por el proyecto. Ejecuta npm install desde la raíz; no se descargará otra versión.");
  }

  const docker = run("docker", ["info"], { timeout: 10_000 });
  if (docker.status !== 0) {
    throw new Error("Docker Desktop no está disponible. Inícialo y vuelve a ejecutar `npm run dev:local`.");
  }

  const localConfig = readSupabaseLocalConfig(readText(configPath));
  const apiUrl = localConfig.apiUrl;
  const probe = probeApi ?? (url => isHttpServiceAvailable(url));
  if (await probe(apiUrl)) return { action: "already-running", apiUrl };

  const status = run(process.execPath, [cli, "status", "--workdir", repoRoot], { timeout: 20_000 });
  if (status.status === 0) {
    throw new Error(
      `Supabase figura activo, pero su API no responde en ${apiUrl}. ` +
      "Revisa `docker ps`, el health de Kong y los puertos publicados; el orquestador no reinicia un stack activo silenciosamente."
    );
  }

  for (const port of localConfig.configuredPorts) {
    const availability = await checkPort(port);
    if (availability.available) continue;
    if (availability.reason === "IN_USE") {
      throw new Error(`El puerto local ${port} está ocupado. Libera el listener o selecciona otro bloque estable en supabase/config.toml.`);
    }
    if (availability.reason === "EXCLUDED") {
      throw new Error(`El puerto local ${port} está excluido o denegado por Windows. Selecciona otro bloque estable en supabase/config.toml.`);
    }
    throw new Error(`El puerto local ${port} no está disponible. Revisa listeners, bindings Docker y rangos excluidos.`);
  }

  const start = run(process.execPath, [cli, "start", "--workdir", repoRoot], { timeout: 150_000 });
  if (start.status !== 0) throw new Error(startFailureMessage(start, apiUrl));

  const ready = waitForApi
    ? await waitForApi(apiUrl)
    : await waitForHttpService({ url: apiUrl, probe });
  if (!ready) {
    throw new Error(`Supabase inició, pero ${apiUrl} no respondió dentro de 60 segundos.`);
  }

  return { action: "started", apiUrl };
}

export function attachSignalForwarding(parent, child) {
  const forwardInterrupt = () => child.kill("SIGINT");
  const forwardTerminate = () => child.kill("SIGTERM");
  parent.once("SIGINT", forwardInterrupt);
  parent.once("SIGTERM", forwardTerminate);
  return () => {
    parent.off("SIGINT", forwardInterrupt);
    parent.off("SIGTERM", forwardTerminate);
  };
}
