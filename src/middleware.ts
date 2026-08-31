import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

function sessionCookieName(req: NextRequest) {
  // Auth.js v5 cookie names (HTTPS on Vercel uses the __Secure- prefix)
  return req.nextUrl.protocol === "https:"
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith("/api/slack") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/api/auth") ||
    pathname === "/login"
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/leave") || pathname.startsWith("/api/")) {
    const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
    const token = await getToken({
      req,
      secret,
      secureCookie: req.nextUrl.protocol === "https:",
      cookieName: sessionCookieName(req),
    });
    if (!token) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const url = new URL("/login", req.url);
      url.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/leave/:path*", "/api/:path*", "/login"],
};
