/**
 * Root landing page for the Companion web app.
 * Bootstrap-only content (T-001); replaced by real onboarding entry in later tasks.
 * @module app/page
 */

import { getVersion } from '@/lib/version';

export default function Home() {
  return (
    <main>
      <h1>Hello Companion</h1>
      <p>v{getVersion()}</p>
    </main>
  );
}