export function resolveCookieSecure(request: Request): boolean {
  const override = parseCookieSecureOverride();
  if (override !== null) return override;
  return isSecureRequest(request);
}

function parseCookieSecureOverride(): boolean | null {
  const raw = process.env.MONITOR_COOKIE_SECURE?.trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

function isSecureRequest(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwardedProto) return forwardedProto === "https";
  return new URL(request.url).protocol === "https:";
}
