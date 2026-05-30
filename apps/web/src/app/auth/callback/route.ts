/**
 * GET /auth/callback — magic link redirect target.
 *
 * Supabase OTP flow envia o usuário pra cá com `?code=<...>` na URL após
 * ele clicar no magic link. Trocamos o code pela session (cookie httpOnly
 * é seteado pelo cliente Supabase SSR via cookieStore) e redirecionamos.
 *
 * Erros (code missing, exchange failed) redirecionam pra /login com flag
 * `?error=<reason>`. Sem expor detalhe técnico — Supabase já registra.
 *
 * @module app/auth/callback/route
 */

import { NextResponse, type NextRequest } from 'next/server';

import { createServerClient } from '../../../shared/db/server';

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error('[auth/callback] exchange_failed', {
      code_length: code.length,
      error_code: error.code ?? 'unknown',
    });
    return NextResponse.redirect(`${origin}/login?error=exchange_failed`);
  }

  return NextResponse.redirect(`${origin}/`);
}
