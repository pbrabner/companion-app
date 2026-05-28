import type { Meta, StoryObj } from "@storybook/react";

import { Input } from "./Input";

const meta: Meta<typeof Input> = {
  title: "Components/Input",
  component: Input,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = { args: { placeholder: "Digite aqui..." } };
export const Email: Story = { args: { type: "email", placeholder: "voce@exemplo.com" } };
export const Password: Story = { args: { type: "password", placeholder: "Senha" } };
export const Disabled: Story = { args: { disabled: true, placeholder: "Desabilitado" } };
export const Invalid: Story = {
  args: { "aria-invalid": true, defaultValue: "valor inválido" },
};
