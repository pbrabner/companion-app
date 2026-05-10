/**
 * Route Handler for POST /api/reflect — accepts a written reflection,
 * persists it under the authenticated user's RLS context, and streams an
 * empathic response from Claude Sonnet 4.6 back to the browser.
 *
 * Stream contract: text/plain chunked. First line is JSON metadata
 * `{"reflection_id": "<uuid>"}\n`. Subsequent chunks are raw Claude text.
 * Final line (only on Claude failure post-INSERT) is JSON
 * `\n{"error":"ai_unavailable","reflection_id":"<uuid>"}\n`.
 *
 * Privacy gate (RF-007 / CA-T009-3 ★ALTO): never logs `content` or `body`,
 * only metadata (user_id, reflection_id, content_length, error_code).
 *
 * @module app/api/reflect/route
 */
