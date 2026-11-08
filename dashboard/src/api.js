export class ApiError extends Error {
  constructor(status, body) { super(body?.error || 'DASHBOARD_UNAVAILABLE'); this.status = status; this.commandID = body?.commandID; }
}
export async function api(path, { body, csrf, signal } = {}) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { 'X-Turnlink-Request': '1', ...(body !== undefined ? { 'Content-Type': 'application/json', 'X-Turnlink-CSRF': csrf || '' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json(); if (!response.ok) throw new ApiError(response.status, value); return value;
}
