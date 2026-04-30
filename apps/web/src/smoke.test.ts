/**
 * Smoke test for the Companion web app bootstrap (T-001).
 * Verifies that the toolchain is wired (Vitest runs, TS path alias resolves)
 * and that the trivial version utility returns a semver string.
 * @module smoke.test
 */

import { describe, it, expect } from 'vitest';
import { getVersion } from '@/lib/version';

describe('Companion web app smoke test (T-001)', () => {
  it('exposes a getVersion() utility that returns a semver string', () => {
    const version = getVersion();
    expect(typeof version).toBe('string');
    expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/);
  });
});