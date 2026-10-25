export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export async function api(path, { method = 'GET', body, userId } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(userId ? { 'x-user-id': userId } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const kes = (n) => `KES ${Number(n || 0).toLocaleString('en-US')}`;
