'use client';

/**
 * MarkdownResponse — renderiza a resposta da IA como markdown.
 * Sem rehype-raw: HTML cru é escapado (default do react-markdown),
 * fechando o vetor XSS (CA-UI-3 ★ALTO). Sem remark-gfm: o prompt gera
 * markdown básico (parágrafos, ênfase, listas, código inline). YAGNI.
 *
 * Classes Tailwind herdam o look do tema (text-foreground etc.).
 * @module app/reflect/MarkdownResponse
 */

import ReactMarkdown, { type Components } from 'react-markdown';

const components: Components = {
  p: ({ children }) => <p className="text-foreground">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 space-y-1 text-foreground">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1 text-foreground">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => (
    <code className="bg-muted px-1 py-0.5 rounded text-sm">{children}</code>
  ),
  a: ({ children, href }) => (
    <a href={href} className="underline hover:text-foreground">
      {children}
    </a>
  ),
};

export function MarkdownResponse({ children }: { children: string }) {
  return (
    <div className="space-y-2">
      <ReactMarkdown components={components}>{children}</ReactMarkdown>
    </div>
  );
}
