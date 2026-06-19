/**
 * Página /onboarding — carrega trilhas e renderiza o wizard. Se já onboardado,
 * manda pro /reflect (não refaz).
 * @module app/onboarding/page
 */
import { redirect } from 'next/navigation';

import { createServerClient } from '@/shared/db/server';
import { OnboardingWizard } from './OnboardingWizard';

export default async function OnboardingPage() {
  const supabase = await createServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarded_at')
    .eq('id', userData.user.id)
    .maybeSingle();
  if ((profile as { onboarded_at: string | null } | null)?.onboarded_at) {
    redirect('/reflect');
  }

  const { data: tracks } = await supabase
    .from('tracks_catalog')
    .select('slug, title, description');

  return <OnboardingWizard tracks={tracks ?? []} />;
}
