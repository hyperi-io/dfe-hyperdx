/**
 * What the engine says about a search before Create Rule is pressed.
 *
 * The engine is the one judge of whether a search makes a valid rule. It
 * answers the dry run of `create-rule` with 200 for a search it would save and
 * 422 problem+json for one it would refuse, with a stable `code`. Nothing here
 * decides what a time bound is.
 */

/** The engine's code for a search with no filter left once time is taken out. */
export const RULE_EMPTY_FILTER = 'rule_empty_filter';

export type RuleCheck =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'valid' }
  // The engine could not be asked, so the button stays as it was and a failure
  // after Create is pressed still reaches the toast.
  | { state: 'unavailable' }
  | { state: 'refused'; refusal: Refusal };

export type Refusal = {
  code: string;
  detail: string;
  droppedBounds: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** The refusal a 422 body carries, or undefined when it is not one. */
export function parseRefusal(body: unknown): Refusal | undefined {
  if (!isRecord(body) || typeof body.code !== 'string') {
    return undefined;
  }
  const detail = typeof body.detail === 'string' ? body.detail : '';
  return {
    code: body.code,
    detail,
    droppedBounds: strings(body.dropped_bounds),
  };
}

/** The words shown beside Create Rule for a refusal. */
export function refusalCopy(refusal: Refusal): {
  summary: string;
  explanation: string;
  bounds: string[];
} {
  if (refusal.code === RULE_EMPTY_FILTER) {
    const onTime = refusal.droppedBounds.length > 0;
    return {
      summary: onTime
        ? 'This search only filters on time.'
        : 'This search has no filter.',
      explanation:
        'A rule needs a condition that picks out the events you want, such as a field match. The hunt sets its own time window.',
      bounds: refusal.droppedBounds,
    };
  }
  return { summary: refusal.detail, explanation: '', bounds: [] };
}

/** The part of a ky HTTPError's response this reads. */
export type ErrorResponse = {
  status: number;
  clone: () => { json: () => Promise<unknown> };
};

/**
 * The response a failed request carries, or undefined for any other error.
 *
 * It reads the shape, not `instanceof HTTPError`: upstream's tests map `ky` to a
 * stub with no HTTPError class, and `instanceof undefined` throws.
 */
export function errorResponse(err: unknown): ErrorResponse | undefined {
  if (!isRecord(err) || !isRecord(err.response)) {
    return undefined;
  }
  const { status, clone } = err.response;
  if (typeof status !== 'number' || typeof clone !== 'function') {
    return undefined;
  }
  return { status, clone: () => clone.call(err.response) };
}
