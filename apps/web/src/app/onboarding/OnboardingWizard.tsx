'use client';

/**
 * Wizard de onboarding (3 passos): privacidade → trilha → baseline.
 * Estado no cliente; grava tudo num único POST /api/onboarding ao concluir.
 * @module app/onboarding/OnboardingWizard
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '../../design-system/components/Button';
import { Card } from '../../design-system/components/Card';
import { Checkbox } from '../../design-system/components/Checkbox';
import { toast } from '../../design-system/components/use-toast';
import { LIFE_AREAS } from './life-areas';

type Track = { slug: string; title: string; description: string };
type Step = 'privacy' | 'track' | 'baseline';

export function OnboardingWizard({ tracks }: { tracks: Track[] }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('privacy');
  const [track, setTrack] = useState<string | null>(null);
  const [mood, setMood] = useState<number | null>(null);
  const [areas, setAreas] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  function toggleArea(slug: string) {
    setAreas((cur) => (cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug]));
  }

  async function handleSubmit() {
    if (track === null || mood === null || areas.length === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true, track, mood, areas }),
      });
      if (!res.ok) {
        setSubmitting(false);
        toast({ variant: 'destructive', title: 'Não deu pra concluir', description: 'Tenta de novo.' });
        return;
      }
      router.push('/reflect');
    } catch {
      setSubmitting(false);
      toast({ variant: 'destructive', title: 'Erro de conexão', description: 'Tenta de novo.' });
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      {step === 'privacy' && (
        <section className="space-y-4">
          <h1 className="text-2xl font-semibold">Antes de começar</h1>
          <p className="text-muted-foreground">
            Tuas reflexões ficam só no teu espaço, protegidas por segurança a nível de linha. O
            conteúdo nunca vai pra analytics ou serviços de terceiros — só você lê o que escreve.
          </p>
          <Button type="button" onClick={() => setStep('track')}>
            Aceito
          </Button>
        </section>
      )}

      {step === 'track' && (
        <section className="space-y-4">
          <h1 className="text-2xl font-semibold">Escolhe uma trilha</h1>
          <div className="space-y-3">
            {tracks.map((t) => (
              <Card
                key={t.slug}
                onClick={() => setTrack(t.slug)}
                className={`cursor-pointer p-4 ${track === t.slug ? 'ring-2 ring-primary' : ''}`}
              >
                <h2 className="font-semibold">{t.title}</h2>
                <p className="text-sm text-muted-foreground">{t.description}</p>
              </Card>
            ))}
          </div>
          <div className="flex justify-between">
            <Button type="button" variant="outline" onClick={() => setStep('privacy')}>
              Voltar
            </Button>
            <Button type="button" disabled={track === null} onClick={() => setStep('baseline')}>
              Avançar
            </Button>
          </div>
        </section>
      )}

      {step === 'baseline' && (
        <section className="space-y-4">
          <h1 className="text-2xl font-semibold">Como você está, no geral?</h1>
          <div>
            <p className="text-sm text-muted-foreground mb-2">Humor (1 = muito baixo, 5 = muito bom)</p>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <Button
                  key={n}
                  type="button"
                  aria-label={`Humor ${n}`}
                  variant={mood === n ? 'default' : 'outline'}
                  onClick={() => setMood(n)}
                >
                  {n}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-2">Áreas que importam pra você agora</p>
            <div className="space-y-2">
              {LIFE_AREAS.map((a) => (
                <label key={a.slug} className="flex items-center gap-2">
                  <Checkbox
                    checked={areas.includes(a.slug)}
                    onCheckedChange={() => toggleArea(a.slug)}
                    aria-label={a.label}
                  />
                  <span>{a.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-between">
            <Button type="button" variant="outline" onClick={() => setStep('track')}>
              Voltar
            </Button>
            <Button
              type="button"
              disabled={mood === null || areas.length === 0 || submitting}
              onClick={handleSubmit}
            >
              {submitting ? 'Concluindo...' : 'Concluir'}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
