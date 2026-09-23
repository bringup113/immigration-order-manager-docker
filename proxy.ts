import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const search = new URLSearchParams(request.nextUrl.searchParams);
  search.delete("_rsc");
  const query = search.toString();
  requestHeaders.set(
    "x-migra-return-to",
    `${request.nextUrl.pathname}${query ? `?${query}` : ""}`,
  );
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon\\.svg|manifest\\.webmanifest|sw\\.js|mobile-offline\\.html|icons/|robots\\.txt|sitemap\\.xml).*)",
  ],
};
