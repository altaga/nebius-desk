import { NextResponse, type NextRequest } from "next/server";

const LOCAL = new Set(["localhost", "127.0.0.1"]);

function hostname(req: NextRequest) {
  return (req.headers.get("host") || "").split(":")[0].toLowerCase();
}

function redirect(req: NextRequest, pathname: string, host?: string) {
  const dest = req.nextUrl.clone();
  dest.pathname = pathname;
  dest.search = "";
  if (host) {
    dest.protocol = "https:";
    dest.hostname = host;
    dest.port = "";
  }
  return NextResponse.redirect(dest);
}

export function middleware(req: NextRequest) {
  const host = hostname(req);
  const { pathname } = req.nextUrl;
  // Static assets must never hit the marketing redirect — Millie's VRM is under /millie/*.vrm.
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/brand") ||
    pathname.startsWith("/millie") ||
    /\.(?:svg|png|jpg|jpeg|gif|webp|ico|vrm|glb|gltf|bin|json|wasm)$/i.test(pathname)
  ) {
    return NextResponse.next();
  }
  if (req.method !== "GET" && req.method !== "HEAD") return NextResponse.next();

  const site = (process.env.SITE_HOST || "").trim().toLowerCase();
  const local = LOCAL.has(host);
  const onApp = host === `app.${site}`;

  // No custom domain yet: the public host serves the introduction and the desk.
  if (local || !site) {
    if (pathname === "/" || pathname === "/login" || pathname === "/dashboard" || pathname === "/pair") {
      return NextResponse.next();
    }
    return redirect(req, "/");
  }

  if (onApp) {
    if (pathname === "/login" || pathname === "/dashboard" || pathname === "/pair") return NextResponse.next();
    return redirect(req, pathname === "/" ? "/login" : "/dashboard");
  }

  if (host !== site) return redirect(req, "/", site);
  if (pathname !== "/") return redirect(req, "/");
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
