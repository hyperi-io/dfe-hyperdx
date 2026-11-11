# Vendored UI fonts

The four UI fonts, served from the image so `next build` makes no request to Google Fonts. `../fonts.ts` loads them with `next/font/local`.

Each file is the latin-subset woff2 that Google Fonts serves `next/font/google`, fetched 2026-11-11 from `https://fonts.googleapis.com/css2` with next's Chrome user agent. They are the bytes upstream's build already downloaded and self-hosted under `.next/static/media`.

| File | Family | Weights | Source (fonts.gstatic.com) | Font version | Licence |
| --- | --- | --- | --- | --- | --- |
| `ibm-plex-mono-latin-{300,400,500,600,700}.woff2` | IBM Plex Mono | static 300-700 | `s/ibmplexmono/v20/` | 2.3 | SIL OFL 1.1, `OFL-ibm-plex-mono.txt` |
| `roboto-mono-latin-variable.woff2` | Roboto Mono | variable 100-700 | `s/robotomono/v31/` | 3.001 | SIL OFL 1.1, `OFL-roboto-mono.txt` |
| `inter-latin-variable.woff2` | Inter | variable 100-900 | `s/inter/v20/` | 4.001 | SIL OFL 1.1, `OFL-inter.txt` |
| `roboto-latin-variable.woff2` | Roboto | variable 100-900 | `s/roboto/v51/` | 3.015 | SIL OFL 1.1, `OFL-roboto.txt` |

The licence files come from `google/fonts` at commit `5bb28733cec313b63fbd415b574b5ae35c8aa8b8`, under `ofl/<family>/OFL.txt`. OFL 1.1 permits bundling the fonts with other software under any licence, including the BSL-licensed dfe-hyperdx image, provided the fonts are not sold on their own and keep their licence.

## Re-vendoring

`../fonts.ts` fails the build when `src/fonts.ts` asks for a weight or CSS variable not listed above. To add one:

1. Fetch `https://fonts.googleapis.com/css2?family=<Family>:wght@<weights>&display=swap` with a current Chrome user agent.
2. Download the `src: url(...)` under the `/* latin */` comment into this directory.
3. Add the file and its weights to `../fonts.ts`, and update the table above.
