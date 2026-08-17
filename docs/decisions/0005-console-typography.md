# 0005 - Console typography: Inter + IBM Plex Mono

**Status:** accepted

## The two fonts

| Role                                                         | Family            | Where it comes from                        |
| ------------------------------------------------------------ | ----------------- | ------------------------------------------ |
| UI text (everything interactive: nav, labels, buttons, body) | **Inter**         | hyperi-graphics brand SSoT `fonts.ui.sans` |
| Mono (queries, code, IDs, raw data values)                   | **IBM Plex Mono** | hyperi-graphics brand SSoT `fonts.ui.mono` |

These are the SAME pair dfe-ui loads (its `layout.tsx` imports exactly `Inter`
and `IBM_Plex_Mono` from next/font), so the embedded HyperDX pages and the
dfe-ui shell around them read as one product.

**Marketing fonts are banned in the console.** Martel Sans and Montserrat are
brand/marketing families (`fonts.marketing` in the same SSoT) - they never
appear in this app.

## Context

The DFE theme is deployment-branding for a console that lives inside dfe-ui's
chrome. A font mismatch between the iframe and its host is immediately visible,
and "which font is the standard" kept being re-asked. This record is the answer,
so it stops being re-litigated.

## How it is wired (do not bypass)

- `src/config/fonts.ts` - `MANTINE_FONT_MAP['Inter']` resolves to
  `var(--font-inter), sans-serif`; the variables come from next/font in
  `pages/_document.tsx` / `pages/_app.tsx`.
- `pages/_app.tsx` pins the DFE theme to Inter regardless of user font
  preference (upstream's font picker only applies to the hyperdx theme).
- Mono surfaces use `var(--font-ibm-plex-mono)` (LogTable, HyperJson, SQL/Lucene
  inputs).
- `src/dfe/__tests__/dfeTheme.test.ts` pins the resolution - a change that
  breaks the pair fails the suite.

## Consequences

- New surfaces take Inter by default (Mantine theme cascade); reach for
  `var(--font-ibm-plex-mono)` only when rendering query text, code, or raw data
  values.
- Never hardcode a family name; always the next/font variables, or the font
  falls back to whatever the viewer's OS ships and the "old hyperdx fonts"
  report comes back.
