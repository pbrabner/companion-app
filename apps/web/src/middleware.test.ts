/**
 * Tests for the Next.js middleware that gates app routes by Supabase
 * session and onboarding status. Validates the three binary acceptance
 * clauses of T-007 (no-session redirect, missing-onboarding redirect,
 * happy path passthrough) plus public-route allowlist coverage.
 * @module middleware.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @supabase/ssr — we control auth.getUser() and the profiles fetch chain
// per-test via these handles.
// ---------------------------------------------------------------------------

type GetUserResult = { data: { user: { id: string } | null }; error: null };
type ProfileResult = { data: { onboarded_at: string | null } | null; error: null };

let getUserResult: GetUserResult = { data: { user: null }, error: null };
let profileResult: ProfileResult = { data: null, error: null };

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => getUserResult),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => profileResult),
        })),
      })),
    })),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers — build NextRequest-shaped objects the middleware expects.
// We use the real next/server module so NextResponse.redirect / .next return
// proper Response instances we can introspect.
// ---------------------------------------------------------------------------

import { NextRequest } from 'next/server';

function makeRequest(pathname: string): NextRequest {
  const url = new URL(`http://localhost:3000${pathname}`);
  return new NextRequest(url);
}

beforeEach(() => {
  // We use clearAllMocks (not resetAllMocks) so the @supabase/ssr factory
  // implementation declared via vi.mock above is preserved between tests;
  // only call history is cleared. Per-test behavior is varied through the
  // closed-over `getUserResult` / `profileResult` handles.
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  getUserResult = { data: { user: null }, error: null };
  profileResult = { data: null, error: null };
});

// ---------------------------------------------------------------------------
// Acceptance clause 1 (binary): no session + /app → 307 + Location /login
// ---------------------------------------------------------------------------

describe('middleware — clause 1: unauthenticated /app access', () => {
  it('redirects (307) to /login when no session cookie hits /app', async () => {
    const { middleware } = await import('@/middleware');
    getUserResult = { data: { user: null }, error: null };

    const response = await middleware(makeRequest('/app'));

    expect(response.status).toBe(307);
    const location = response.headers.get('location');
    expect(location).not.toBeNull();
    expect(new URL(location!).pathname).toBe('/login');
  });
});

// ---------------------------------------------------------------------------
// Acceptance clause 2 (binary): session + onboarded_at=null + /app → 307 /onboarding
// ---------------------------------------------------------------------------

describe('middleware — clause 2: authenticated but not onboarded', () => {
  it('redirects (307) to /onboarding when user has no onboarded_at', async () => {
    const { middleware } = await import('@/middleware');
    getUserResult = { data: { user: { id: 'user-123' } }, error: null };
    profileResult = { data: { onboarded_at: null }, error: null };

    const response = await middleware(makeRequest('/app'));

    expect(response.status).toBe(307);
    const location = response.headers.get('location');
    expect(location).not.toBeNull();
    expect(new URL(location!).pathname).toBe('/onboarding');
  });
});

// ---------------------------------------------------------------------------
// Acceptance clause 3 (binary): session + onboarded_at valid + /app → passthrough
// ---------------------------------------------------------------------------

describe('middleware — clause 3: authenticated and onboarded', () => {
  it('passes through (no redirect) when user is fully onboarded', async () => {
    const { middleware } = await import('@/middleware');
    getUserResult = { data: { user: { id: 'user-123' } }, error: null };
    profileResult = { data: { onboarded_at: '2026-04-15T10:00:00Z' }, error: null };

    const response = await middleware(makeRequest('/app'));

    // NextResponse.next() yields a non-redirect response. A redirect would be
    // 3xx with a Location header; passthrough has no Location set.
    expect(response.headers.get('location')).toBeNull();
    expect(response.status).toBeLessThan(300);
  });
});

// ---------------------------------------------------------------------------
// Edge: public routes pass through without a session cookie.
// ---------------------------------------------------------------------------

describe('middleware — public routes bypass auth gate', () => {
  it.each(['/', '/login', '/auth/callback'])(
    'lets %s through without redirect even when unauthenticated',
    async (pathname) => {
      const { middleware } = await import('@/middleware');
      getUserResult = { data: { user: null }, error: null };

      const response = await middleware(makeRequest(pathname));

      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBeLessThan(300);
    },
  );
});
