#!/usr/bin/env python3
#  Project:      dfe-hyperdx
#  File:         scripts/vendor-fonts.py
#  Purpose:      Vendor the console's Google Fonts and write their next/font/local loaders
#  Language:     Python
#
#  License:      MIT (inherits upstream hyperdxio/hyperdx)
#  Copyright:    (c) 2026 HYPERI PTY LIMITED
"""Fetch every subset Google Fonts serves next/font for the four UI families.

Writes the woff2 files to packages/app/src/dfe/fonts/ and regenerates
packages/app/src/dfe/fonts.ts: one `localFont` call per subset, sharing a
font-family and carrying Google's unicode-range, so a browser downloads only
the scripts a page uses. next/font only accepts literal arguments, hence the
generated file.

Usage::

    python3 scripts/vendor-fonts.py
    npx prettier --write packages/app/src/dfe/fonts.ts
"""

import re
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FONT_DIR = ROOT / "packages/app/src/dfe/fonts"
LOADERS = ROOT / "packages/app/src/dfe/fonts.ts"

# next/font's own user agent: Google picks the file format and subsets from it.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36"
)

GOOGLE = {"https://fonts.googleapis.com", "https://fonts.gstatic.com"}

FACE = re.compile(
    r"/\* (?P<subset>[\w-]+) \*/\s*@font-face \{[^}]*?font-weight: (?P<weight>\d+);"
    r"[^}]*?src: url\((?P<url>[^)]+)\)[^}]*?unicode-range: (?P<range>[^;]+);"
)


@dataclass(frozen=True)
class Family:
    name: str  # Google family name, and the loader src/fonts.ts imports
    ident: str  # font-family in the CSS, and the latin loader's const name
    slug: str  # file name prefix
    variable: str
    weights: tuple[str, ...]


FAMILIES = (
    Family("IBM Plex Mono", "ibmPlexMono", "ibm-plex-mono", "--font-ibm-plex-mono",
           ("300", "400", "500", "600", "700")),
    Family("Roboto Mono", "robotoMono", "roboto-mono", "--font-roboto-mono",
           ("100", "300", "400", "500", "700")),
    Family("Inter", "inter", "inter", "--font-inter",
           ("100", "200", "300", "400", "500", "600", "700", "800", "900")),
    Family("Roboto", "roboto", "roboto", "--font-roboto",
           ("100", "300", "400", "500", "700")),
)  # fmt: skip


@dataclass
class Subset:
    name: str
    unicode_range: str
    files: dict[str, str]  # weight -> url, in Google's order


def parse_css(css: str) -> list[Subset]:
    """Group Google's @font-face blocks by subset, keeping Google's order."""
    subsets: dict[str, Subset] = {}
    for face in FACE.finditer(css):
        subset = subsets.setdefault(
            face["subset"], Subset(face["subset"], face["range"], {})
        )
        subset.files[face["weight"]] = face["url"]
    return list(subsets.values())


def is_variable(subset: Subset) -> bool:
    """Google serves one variable file for every weight of a variable family."""
    return len(set(subset.files.values())) == 1


def file_name(family: Family, subset: Subset, weight: str | None) -> str:
    return f"{family.slug}-{subset.name}-{weight or 'variable'}.woff2"


def const_name(family: Family, subset: Subset) -> str:
    if subset.name == "latin":
        return family.ident
    words = subset.name.split("-")
    return family.ident + "".join(w.capitalize() for w in words)


def loader_ts(family: Family, subset: Subset) -> str:
    """One localFont call. Latin carries the CSS variable and preloads."""
    lines = [f"const {const_name(family, subset)} = localFont({{"]
    weights = list(subset.files)
    if is_variable(subset):
        lines.append(f"  src: './fonts/{file_name(family, subset, None)}',")
        lines.append(f"  weight: '{min(weights, key=int)} {max(weights, key=int)}',")
    else:
        lines.append("  src: [")
        for weight in weights:
            path = f"./fonts/{file_name(family, subset, weight)}"
            lines.append(f"    {{ path: '{path}', weight: '{weight}' }},")
        lines.append("  ],")
    lines.append("  declarations: [")
    lines.append(f"    {{ prop: 'font-family', value: '{family.ident}' }},")
    # Laid out the way prettier formats it, so the generated file is stable.
    entry = f"    {{ prop: 'unicode-range', value: '{subset.unicode_range}' }},"
    value = f"      value: '{subset.unicode_range}',"
    if len(value) > 80:
        value = f"      value:\n        '{subset.unicode_range}',"
    if len(entry) > 80:
        entry = f"    {{\n      prop: 'unicode-range',\n{value}\n    }},"
    lines.append(entry)
    lines.append("  ],")
    if subset.name == "latin":
        lines.append(f"  variable: '{family.variable}',")
    lines.append("  display: 'swap',")
    if subset.name != "latin":
        lines.append("  preload: false,")
        lines.append("  adjustFontFallback: false,")
    lines.append("});")
    return "\n".join(lines)


def key(name: str) -> str:
    return f"'{name}'" if "-" in name else name


def export_ts(family: Family, subsets: list[Subset]) -> str:
    if all(is_variable(s) for s in subsets):
        weights = [w for s in subsets for w in s.files]
        coverage = f"{{ min: {min(weights, key=int)}, max: {max(weights, key=int)} }}"
    else:
        common = [w for w in family.weights if all(w in s.files for s in subsets)]
        coverage = "[" + ", ".join(f"'{w}'" for w in common) + "]"
    entries = "\n".join(f"    {key(s.name)}: {const_name(family, s)}," for s in subsets)
    return (
        f"export const {family.name.replace(' ', '_')} = vendoredFont("
        f"{family.ident}, '{family.name}', {{\n"
        f"  variable: '{family.variable}',\n"
        f"  weights: {coverage},\n"
        f"  subsets: {{\n{entries}\n  }},\n"
        "});"
    )


def render(families: list[tuple[Family, list[Subset]]]) -> str:
    head = (
        "/**\n"
        " * The UI fonts, vendored so `next build` fetches nothing from Google Fonts.\n"
        " * `src/fonts.ts` imports these four loaders in place of `next/font/google`.\n"
        " * Generated by scripts/vendor-fonts.py. Sources and licences: fonts/README.md.\n"
        " */\n"
        "import localFont from 'next/font/local';\n\n"
        "import { vendoredFont } from './vendoredFont';\n"
    )
    loaders = [loader_ts(f, s) for f, subsets in families for s in subsets]
    exports = [export_ts(f, subsets) for f, subsets in families]
    return head + "\n" + "\n\n".join(loaders + exports) + "\n"


def fetch(url: str) -> bytes:
    # The font URLs come out of Google's CSS, so refuse anything but Google's
    # two HTTPS hosts before urllib sees it (it would also open file://).
    origin = urllib.parse.urlsplit(url)._replace(path="", query="", fragment="")
    if origin.geturl() not in GOOGLE:
        sys.exit(f"refusing to fetch {url}: not a Google Fonts HTTPS URL")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    # The origin allowlist above is checked before this call.
    # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def main() -> int:
    families = []
    wanted: set[str] = set()
    for family in FAMILIES:
        query = family.name.replace(" ", "+") + ":wght@" + ";".join(family.weights)
        css = fetch(
            f"https://fonts.googleapis.com/css2?family={query}&display=swap"
        ).decode()
        subsets = parse_css(css)
        if not subsets or subsets[-1].name != "latin":
            sys.exit(f"{family.name}: expected latin last in Google's CSS")
        for subset in subsets:
            variable = is_variable(subset)
            for weight, url in subset.files.items():
                name = file_name(family, subset, None if variable else weight)
                if name not in wanted:
                    (FONT_DIR / name).write_bytes(fetch(url))
                    wanted.add(name)
                    print(f"{name}  {url}")
        families.append((family, subsets))
    for stale in sorted({p.name for p in FONT_DIR.glob("*.woff2")} - wanted):
        (FONT_DIR / stale).unlink()
        print(f"removed {stale}")
    LOADERS.write_text(render(families), encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
