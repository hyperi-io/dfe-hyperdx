// MongoDB error shapes the dfe layer branches on.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

// Raised when an insert collides on a unique index; FerretDB surfaces the same code.
const DUPLICATE_KEY = 11000;

/** True when `err` is a unique-index collision, i.e. a concurrent writer won. */
export function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === DUPLICATE_KEY
  );
}
