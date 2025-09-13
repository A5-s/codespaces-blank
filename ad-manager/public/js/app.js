export function getToken() {
  return localStorage.getItem("token");
}
export function setToken(t) {
  localStorage.setItem("token", t);
}
export async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}), "content-type": "application/json" };
  const t = getToken();
  if (t) headers.authorization = `Bearer ${t}`;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}