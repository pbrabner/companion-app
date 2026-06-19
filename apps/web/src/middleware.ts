/**
 * Next.js middleware that injects a server-side Supabase client per
 * request, gates protected routes by session presence, and forces
 * authenticated-but-not-onboarded users into /onboarding before they
 * can reach rotas de produto (/app, /reflect, /reflections). Public
 * routes (/, /login, /auth/callback) always pass through. Implements
 * T-007 acceptance criteria.
 * @module middleware
 */

import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

const PUBLIC_ROUTES = new Set(['/', '/login', '/auth/callback', '/auth/reset-password']);

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;
  const isPublic = PUBLIC_ROUTES.has(pathname);

  // Always create the response object first so cookie writes from the
  // Supabase SSR client (session refresh) ride along with whatever we
  // ultimately return.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    readEnv('NEXT_PUBLIC_SUPABASE_URL'),
    readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Public routes never gate — return whatever we've built so far.
  if (isPublic) {
    return response;
  }

  // Unauthenticated access to any non-public route -> /login.
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url, 307);
  }

  // Rotas de produto exigem onboarding completo. /onboarding nunca é gateado
  // por onboarding (evita loop) mas exige sessão (já coberto acima).
  // Match exato ou subpath (evita falso-positivo tipo /application casar /app).
  const ONBOARDING_GATED_PREFIXES = ['/app', '/reflect', '/reflections'];
  const needsOnboarding =
    pathname !== '/onboarding' &&
    ONBOARDING_GATED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));

  if (needsOnboarding) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('onboarded_at')
      .eq('id', user.id)
      .single();

    if (!profile?.onboarded_at) {
      const url = request.nextUrl.clone();
      url.pathname = '/onboarding';
      return NextResponse.redirect(url, 307);
    }
  }

  return response;
}

export const config = {
  // Exclui /api/* — as rotas API se auto-autenticam e devem responder JSON
  // (não redirect HTML). Sem isso, um POST com sessão expirada levaria 307.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
