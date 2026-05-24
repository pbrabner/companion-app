// Storybook preview: globals + dark mode toggle + base CSS.
//
// Importa globals.css pra aplicar tokens HSL nos stories. Decorator alterna
// .dark class na div root pra cobertura visual de ambos os temas.
import React from "react";
import type { Preview } from "@storybook/react";
import "../globals.css";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: "light",
      values: [
        { name: "light", value: "hsl(0 0% 100%)" },
        { name: "dark", value: "hsl(0 0% 4%)" },
      ],
    },
  },
  globalTypes: {
    theme: {
      description: "Theme",
      defaultValue: "light",
      toolbar: {
        title: "Theme",
        icon: "circlehollow",
        items: ["light", "dark"],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme as string;
      return (
        <div className={theme === "dark" ? "dark" : ""}>
          <div className="bg-background text-foreground p-6 min-h-screen">
            <Story />
          </div>
        </div>
      );
    },
  ],
};

export default preview;
