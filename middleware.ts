import { NextResponse, type NextRequest } from "next/server";

/**
 * Local-only deployment: all routes are accessible without Supabase auth middleware.
 */
export async function middleware(_request: NextRequest) {
  void _request;
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
