/**
 * Tests for the Supabase server-side client factory (T-002).
 * Validates that createServerClient is exported as a function and that
 * invoking it returns an object exposing the .from() entry-point used
 * everywhere in the app.
 * @module shared/db/connection.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockResolvedValue({ data: [{ '?column?': 1 }], error: null }),
    })),
  })),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [],
    set: vi.fn(),
  })),
}));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
});

describe('createServerClient (T-002)', () => {
  it('imports createServerClient as a function', async () => {
    const mod = await import('@/shared/db/server');
    expect(typeof mod.createServerClient).toBe('function');
  });

  it('returns a Supabase client exposing the .from() method', async () => {
    const { createServerClient } = await import('@/shared/db/server');
    const client = await createServerClient();
    expect(client).toBeDefined();
    expect(typeof client.from).toBe('function');
  });
});