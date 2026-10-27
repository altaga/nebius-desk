/** Server-only env. Never import from client components. */
export function getDeskApiUrl(): string {
  const url =
    process.env.DESK_CLOUD_URL ||
    process.env.DESK_API_URL ||
    process.env.API_URL ||
    // local fallback only — never a public NEXT_PUBLIC_* secret
    "http://127.0.0.1:8000";
  return url.replace(/\/$/, "");
}
