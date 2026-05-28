export const config = {
  storybookShots: {
    storybookUrl: './storybook-static',
  },
  imagePathBaseline: './.lostpixel/baseline',
  imagePathCurrent: './.lostpixel/current',
  imagePathDifference: './.lostpixel/difference',
  // 0.005 (0.5%) acomoda variancia de font-rendering entre runs Ubuntu CI
  // (medido empirico: ~0.26% drift consistente em ~14/36 stories).
  // Mudancas visuais reais geram diffs >> 0.5%, ainda detectaveis.
  threshold: 0.005,
  generateOnly: false,
  // Espera fontes + animacoes (anti-flake)
  waitBeforeScreenshot: 1000,
  failOnDifference: true,
};
