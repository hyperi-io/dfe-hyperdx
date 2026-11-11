/**
 * Stands in for a `next/font/google` loader. `src/fonts.ts` keeps upstream's
 * calls, so this checks each call against the weights we vendor and fails the
 * build when upstream asks for one we lack.
 */

type GoogleFontCall = {
  weight: string | string[];
  variable: string;
  [option: string]: unknown;
};

export type VendoredCoverage = {
  variable: string;
  weights: readonly string[] | { min: number; max: number };
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
    const missing = [call.weight].flat().filter(w => !covers(coverage, w));
    if (call.variable !== coverage.variable || missing.length > 0) {
      throw new Error(
        `src/fonts.ts asks ${family} for ${call.variable} with weights ` +
          `${[call.weight].flat().join(', ')}, which src/dfe/fonts.ts does ` +
          `not vendor (missing: ${missing.join(', ') || 'none'}, variable ` +
          `${coverage.variable}). Re-vendor per src/dfe/fonts/README.md.`,
      );
    }
    return font;
  };
}
