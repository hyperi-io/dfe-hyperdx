/**
 * Stands in for a `next/font/google` loader. `src/fonts.ts` keeps upstream's
 * calls, so this checks each call against the weights and subsets we vendor
 * and fails the build when upstream asks for one we lack.
 */

type GoogleFontCall = {
  weight: string | string[];
  variable: string;
  subsets?: string[];
  [option: string]: unknown;
};

export type VendoredCoverage = {
  variable: string;
  weights: readonly string[] | { min: number; max: number };
  // Every subset's loader, keyed by Google's subset name. Referencing them
  // here is what keeps their @font-face rules in the bundle.
  subsets: Record<string, unknown>;
};

const covers = ({ weights }: VendoredCoverage, weight: string) =>
  'min' in weights
    ? Number(weight) >= weights.min && Number(weight) <= weights.max
    : weights.includes(weight);

export function vendoredFont<Font>(
  font: Font,
  family: string,
  coverage: VendoredCoverage,
) {
  return (call: GoogleFontCall): Font => {
    const missing = [
      ...[call.weight].flat().filter(w => !covers(coverage, w)),
      ...(call.subsets ?? []).filter(s => !Object.hasOwn(coverage.subsets, s)),
    ];
    if (call.variable !== coverage.variable || missing.length > 0) {
      throw new Error(
        `src/fonts.ts asks ${family} for ${call.variable} with weights ` +
          `${[call.weight].flat().join(', ')} and subsets ` +
          `${(call.subsets ?? []).join(', ')}, which src/dfe/fonts.ts does ` +
          `not vendor (missing: ${missing.join(', ') || 'none'}, variable ` +
          `${coverage.variable}). Re-run scripts/vendor-fonts.py.`,
      );
    }
    return font;
  };
}
