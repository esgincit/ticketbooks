import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "strike_session";
const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password", "/verify-otp", "/verify-email"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    if (hasSession) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return NextResponse.next();
  }

  // /.well-known: public OAuth discovery metadata for MCP clients
  if (!hasSession && !pathname.startsWith("/api/") && !pathname.startsWith("/.well-known/")) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
