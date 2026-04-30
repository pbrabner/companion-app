/**
 * Returns the semver version string of the Companion web app.
 * Source of truth is the bundled package.json version field.
 * @module lib/version
 */

import pkg from '../../package.json';

export function getVersion(): string {
  return pkg.version;
}