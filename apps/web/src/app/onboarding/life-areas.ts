/**
 * Lista fixa de áreas de vida oferecidas no baseline do onboarding.
 * Slugs persistidos em onboarding_baseline.life_areas; labels só pra UI.
 * @module app/onboarding/life-areas
 */
export const LIFE_AREAS = [
  { slug: 'trabalho', label: 'Trabalho' },
  { slug: 'relacionamentos', label: 'Relacionamentos' },
  { slug: 'saude-fisica', label: 'Saúde física' },
  { slug: 'saude-emocional', label: 'Saúde emocional' },
  { slug: 'proposito', label: 'Propósito / sentido' },
  { slug: 'financas', label: 'Finanças' },
  { slug: 'descanso', label: 'Descanso / lazer' },
] as const;

export const LIFE_AREA_SLUGS: string[] = LIFE_AREAS.map((a) => a.slug);
