/**
 * DFE: a ClickHouse role can constrain `max_rows_to_read`, and HyperDX sends
 * it on most metadata and filter queries (`'0'` to lift the limit, or a
 * team-configured value). The server refuses the setting, and the client then
 * drops it and retries once.
 *
 * Upstream only recognises `READONLY` (code 164), which is what a read-only
 * setting returns. A constrained setting returns `SETTING_CONSTRAINT_VIOLATION`
 * (code 452), whether the value is above the role's MAX or below its MIN.
 */

type ClickhouseErrorShape = { type?: unknown; message?: unknown };

/**
 * Whether `error` is the server refusing a `max_rows_to_read` the client sent.
 *
 * Only the first attempt can be refused. A query that was in flight when a
 * sibling query already set the client's flag fails the same way, and must
 * still retry without the setting rather than surface the refusal.
 */
export function dfeIsRowLimitRejected(
  error: ClickhouseErrorShape,
  attempts: number,
): boolean {
  return (
    attempts === 0 &&
    (error.type === 'READONLY' ||
      error.type === 'SETTING_CONSTRAINT_VIOLATION') &&
    typeof error.message === 'string' &&
    error.message.includes('max_rows_to_read')
  );
}
