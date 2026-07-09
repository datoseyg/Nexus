// Fetch/auth helpers Workers-nativos - equivalente edge de src/lib/http.js
// del pipeline local. Misma forma de getJson()/basicAuth(): unico cambio
// real es que basicAuthHeader() usa btoa() (Web API global del runtime de
// Workers) en vez de Buffer.from(...).toString("base64") - Buffer es un
// built-in de Node que no existe en un isolate de Workers.

export class UpstreamRequestError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
    bodySnippet: string
  ) {
    super(`GET ${url} fallo con ${status}: ${bodySnippet}`);
    this.name = "UpstreamRequestError";
  }
}

export async function getJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    ...init,
    headers: { Accept: "application/json", ...(init?.headers as Record<string, string> | undefined) }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new UpstreamRequestError(url, response.status, text.slice(0, 500));
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`La respuesta de ${url} no es JSON valido: ${text.slice(0, 500)}`);
  }
}

// btoa() codifica code units Latin1 (0-255) - suficiente para credenciales
// de API (usuario/token ASCII), unico uso real de esta funcion hoy. Si
// alguna vez hiciera falta Basic Auth con caracteres fuera de ese rango,
// reemplazar por una codificacion UTF-8 a base64 explicita en vez de
// asumir que btoa() la cubre.
export function basicAuthHeader(username: string, password: string): string {
  return `Basic ${btoa(`${username}:${password}`)}`;
}
