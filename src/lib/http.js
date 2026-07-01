export async function getJson(url, options = {}) {
  const response = await fetch(url, {
    method: "GET",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `GET ${url} failed with ${response.status} ${response.statusText}\n${text}`
    );
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Response was not valid JSON from ${url}\n${text}`);
  }
}

export function basicAuth(username, password) {
  const raw = `${username}:${password}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}