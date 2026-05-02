/**
 * Next.js middleware that injects a server-side Supabase client per
 * request, gates protected routes by session presence, and forces
 * authenticated-but-not-onboarded users into /onboarding before they
 * can reach /app. Public routes (/, /login, /auth/callback) always
 * pass through. Implements T-007 acceptance criteria.
 * @module middleware
 */

import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

const PUBLIC_ROUTES = new Set(['/', '/login', '/auth/callback']);

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

  // Authenticated users hitting /app must be onboarded; otherwise route
  // them to /onboarding to finish the wizard.
  if (pathname.startsWith('/app')) {
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health).*)'],
};
