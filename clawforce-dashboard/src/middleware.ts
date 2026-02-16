import { auth } from "@/auth";

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Auth not configured — open dashboard
  if (!process.env.AUTH_SECRET) return;

  // Public routes
  if (pathname === "/login" || pathname.startsWith("/api/auth")) return;

  // Not authenticated — redirect or 401
  if (!req.auth) {
    if (pathname.startsWith("/api/")) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    return Response.redirect(new URL("/login", req.url));
  }
});

export const config = {
  matcher: [
    "/((?!_next|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
