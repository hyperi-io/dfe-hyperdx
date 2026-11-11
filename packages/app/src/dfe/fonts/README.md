# Vendored UI fonts

The four UI fonts, served from the image so `next build` makes no request to Google Fonts. `../fonts.ts` loads them with `next/font/local`.

Each file is a woff2 subset Google Fonts serves `next/font/google`, fetched 2026-11-11 from `https://fonts.googleapis.com/css2` with next's Chrome user agent. Every subset Google returns is vendored, with Google's `unicode-range`, so the browser downloads only the scripts a page renders. Latin preloads, as it did with `next/font/google`.

| Family | Subsets | Weights | Files | Source (fonts.gstatic.com) | Font version | Licence |
| --- | --- | --- | --- | --- | --- | --- |
| IBM Plex Mono | cyrillic-ext, cyrillic, vietnamese, latin-ext, latin | static 300, 400, 500, 600, 700 | `ibm-plex-mono-<subset>-<weight>.woff2` (25) | `s/ibmplexmono/v20/` | 2.3 | SIL OFL 1.1, `OFL-ibm-plex-mono.txt` |
| Roboto Mono | cyrillic-ext, cyrillic, greek, vietnamese, latin-ext, latin | variable 100-700 | `roboto-mono-<subset>-variable.woff2` (6) | `s/robotomono/v31/` | 3.001 | SIL OFL 1.1, `OFL-roboto-mono.txt` |
| Inter | cyrillic-ext, cyrillic, greek-ext, greek, vietnamese, latin-ext, latin | variable 100-900 | `inter-<subset>-variable.woff2` (7) | `s/inter/v20/` | 4.001 | SIL OFL 1.1, `OFL-inter.txt` |
| Roboto | cyrillic-ext, cyrillic, greek-ext, greek, math, symbols, vietnamese, latin-ext, latin | variable, declared 100-700 as Google declares it | `roboto-<subset>-variable.woff2` (9) | `s/roboto/v51/` | 3.015 | SIL OFL 1.1, `OFL-roboto.txt` |

The 47 files total 709,384 bytes. A browser fetches latin plus whichever other subsets the page's text needs.

The licence files come from `google/fonts` at commit `5bb28733cec313b63fbd415b574b5ae35c8aa8b8`, under `ofl/<family>/OFL.txt`. OFL 1.1 permits bundling the fonts with other software under any licence, including the BSL-licensed dfe-hyperdx image, provided the fonts are not sold on their own and keep their licence.

## Re-vendoring

`../fonts.ts` fails the build when `src/fonts.ts` asks for a weight, subset or CSS variable not vendored here. To refresh or extend the set, edit `FAMILIES` in `scripts/vendor-fonts.py`, then run it from the repo root:

```
python3 scripts/vendor-fonts.py
```

It rewrites the woff2 files and `../fonts.ts`, and removes files no longer served. Update the table above to match.
