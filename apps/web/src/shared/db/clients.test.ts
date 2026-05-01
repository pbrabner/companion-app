/**
 * Tests for the three Supabase client factories — createServerClient
 * (SSR cookies, RLS user), createBrowserClient (anon key, RLS user) and
 * createServiceClient (service_role, bypasses RLS). Replaces the older
 * connection.test.ts (T-002) so all client factories live in a single
 * suite tied to the T-005 acceptance criteria.
 * @module shared/db/clients.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockResolvedValue({ data: [{ '?column?': 1 }], error: null }),
    })),
  })),
  createBrowserClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  })),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ data: [{ id: 'evt-1' }], error: null }),
    })),
  })),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [],
    set: vi.fn(),
  })),
}));

vi.mock('server-only', () => ({}));

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

describe('createServerClient (SSR, RLS user)', () => {
  it('exports createServerClient as a function', async () => {
    const mod = await import('@/shared/db/server');
    expect(typeof mod.createServerClient).toBe('function');
  });

  it('returns a Supabase client exposing the .from() method', async () => {
    const { createServerClient } = await import('@/shared/db/server');
    const client = await createServerClient();
    expect(client).toBeDefined();
    expect(typeof client.from).toBe('function');
  });

  it('invokes @supabase/ssr createServerClient with NEXT_PUBLIC env vars', async () => {
    const ssr = await import('@supabase/ssr');
    const { createServerClient } = await import('@/shared/db/server');
    await createServerClient();
    expect(ssr.createServerClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'test-anon-key',
      expect.objectContaining({ cookies: expect.any(Object) }),
    );
  });
});

describe('createBrowserClient (public, RLS user)', () => {
  it('exports createBrowserClient as a function', async () => {
    const mod = await import('@/shared/db/browser');
    expect(typeof mod.createBrowserClient).toBe('function');
  });

  it('returns a Supabase client exposing the .from() method', async () => {
    const { createBrowserClient } = await import('@/shared/db/browser');
    const client = createBrowserClient();
    expect(client).toBeDefined();
    expect(typeof client.from).toBe('function');
  });

  it('invokes @supabase/ssr createBrowserClient with NEXT_PUBLIC env vars', async () => {
    const ssr = await import('@supabase/ssr');
    const { createBrowserClient } = await import('@/shared/db/browser');
    createBrowserClient();
    expect(ssr.createBrowserClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'test-anon-key',
    );
  });
});

describe('createServiceClient (service_role, bypasses RLS)', () => {
  it('exports createServiceClient as a function', async () => {
    const mod = await import('@/shared/db/service');
    expect(typeof mod.createServiceClient).toBe('function');
  });

  it('returns a Supabase client exposing the .from() method', async () => {
    const { createServiceClient } = await import('@/shared/db/service');
    const client = createServiceClient();
    expect(client).toBeDefined();
    expect(typeof client.from).toBe('function');
  });

  it('uses the SUPABASE_SERVICE_ROLE_KEY (not anon) when calling createClient', async () => {
    const supabaseJs = await import('@supabase/supabase-js');
    const { createServiceClient } = await import('@/shared/db/service');
    createServiceClient();
    expect(supabaseJs.createClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'test-service-role-key',
      expect.any(Object),
    );
  });

  it('inserts a safety_events row successfully (mock — bypasses RLS)', async () => {
    const { createServiceClient } = await import('@/shared/db/service');
    const client = createServiceClient();
    const result = await client.from('safety_events').insert({
      user_id: '00000000-0000-0000-0000-00000000000a',
      trigger_text: 'mock trigger',
      action_taken: 'handoff',
    });
    expect(result.error).toBeNull();
    expect(result.data).toEqual([{ id: 'evt-1' }]);
  });

  it('imports server-only as the very first import (defense in depth)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const filePath = path.resolve(__dirname, 'service.ts');
    const source = fs.readFileSync(filePath, 'utf8');
    // Strip the leading TSDoc block (header is comments, not code).
    const afterHeader = source.replace(/^\s*\/\*\*[\s\S]*?\*\/\s*/, '');
    const firstNonEmptyLine = afterHeader.split('\n').find((line) => line.trim().length > 0) ?? '';
    expect(firstNonEmptyLine.trim()).toBe("import 'server-only';");
  });
});
