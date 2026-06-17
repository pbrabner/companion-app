# Smoke CA-CSF-7 — Fallback Sonnet→Gemini no chatStream

**Data:** 2026-06-16
**Operador:** Pacini
**Ambiente:** dev server localhost:3001, `.env.local` com `ANTHROPIC_API_KEY` **ausente** e `GEMINI_API_KEY` presente (condição que força o fallback).

## Objetivo
Com o Anthropic indisponível, uma reflexão no `/reflect` deve receber resposta
empática **via Gemini** (streaming), em vez de "IA indisponível".

## Resultado: PASS

Reflexão escrita (tema: dificuldade de sustentar foco, multitarefa, pular entre
VS Code/YouTube/WhatsApp). A UI renderizou uma resposta empática completa em
markdown — **sem** o erro "IA indisponível".

Log do dev server:
```
POST /api/reflect 200 in 13029ms
```
Nenhum `[reflect] ai_unavailable` registrado — o caminho de fallback (falha na
abertura do stream Anthropic → `chatStreamGeminiFallback`) rodou limpo. A duração
(~13s) é consistente com uma resposta streamada completa do Gemini.

## O que ficou provado
- **CA-CSF-2:** Anthropic falha na abertura (chave ausente) → `chatStream` cai pro
  Gemini sem lançar.
- **CA-CSF-7:** resposta empática entregue via Gemini, em produção, ponta-a-ponta.
- **Rota intacta:** `/reflect` não mudou; o `ai_unavailable` só dispararia se os
  dois provedores caíssem.
- **Privacy:** nenhum conteúdo/erro vazado em log (só `POST ... 200`).

## Pré-smoke (automatizado)
- Suite: 123 pass (5 novos), 5 skipped (evals)
- Typecheck: 0 erros
- Build Next.js: limpo
- QA verdict: PASS
