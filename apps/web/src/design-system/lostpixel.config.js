export const config = {
  storybookShots: {
    storybookUrl: './storybook-static',
  },
  imagePathBaseline: './.lostpixel/baseline',
  imagePathCurrent: './.lostpixel/current',
  imagePathDifference: './.lostpixel/difference',
  threshold: 0.001,
  generateOnly: false,
  waitBeforeScreenshot: 500,
  failOnDifference: true,
};
