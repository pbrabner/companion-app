/**
 * Tests for the POST /api/reflect Route Handler. Mocks @/shared/db/server
 * and @/shared/ai/client — no real network/DB calls. Covers 12 scenarios
 * mapping CA-T009-1..8 from the spec, including privacy gate (sentinel
 * injection in console spies).
 * @module app/api/reflect/route.test
 */
