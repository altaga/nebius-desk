/** Build same-origin BFF URL that reverse-proxies a board localhost web port. */

export function parseBoardLocalUrl(url: string): { port: number; path: string } | null {
  try {
    const u = new URL(url);
    if (!["127.0.0.1", "localhost"].includes(u.hostname)) return null;
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    if (!Number.isFinite(port) || port < 1) return null;
    return { port, path: u.pathname || "/" };
  } catch {
    return null;
  }
}

export function boardInteractivePreviewSrc(deviceId: string, boardUrl: string): string | null {
  const parsed = parseBoardLocalUrl(boardUrl);
  if (!parsed || !deviceId) return null;
  const root = `/api/desk/v1/devices/${encodeURIComponent(deviceId)}/api/edge/preview/${parsed.port}`;
  const deskBase = `${root}/`;
  const path = parsed.path === "/" ? "/" : parsed.path;
  const q = new URLSearchParams({ __desk_base: deskBase });
  return `${root}${path}?${q.toString()}`;
}
