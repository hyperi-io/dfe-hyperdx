// MongoDB's duplicate-key error, raised when concurrent inserts collide on a
// unique index. FerretDB surfaces the same code.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

const DUPLICATE_KEY = 11000;

export function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === DUPLICATE_KEY
  );
}
