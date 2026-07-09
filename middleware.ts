import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { BETA_GATE_ENABLED, BETA_GATE_COOKIE } from '@/lib/betaGate';

export async function middleware(request: NextRequest) {
  if (BETA_GATE_ENABLED && request.nextUrl.pathname === '/login' && !request.cookies.get(BETA_GATE_COOKIE)) {
    const url = request.nextUrl.clone();
    const next = url.pathname + url.search;
    url.pathname = '/under-construction';
    url.search = `?next=${encodeURIComponent(next)}`;
    return NextResponse.redirect(url);
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    // Skip static assets and image optimization files.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
