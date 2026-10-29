/**
 * DFE: whether the signed-in session is the engine's read-only role.
 *
 * The server refuses a read-only session's saved-search writes and the engine
 * refuses its rule creation, so the page leaves those actions out rather than
 * offering a button that only answers 403. The server stays the control, and an
 * answer this cannot get (a deployment outside DFE mode has no route) reads as
 * "not read-only", which keeps upstream's page as it is.
 *
 * Plain state rather than react-query: DBSearchPage calls this, and upstream's
 * tests render that page behind a PARTIAL `@tanstack/react-query` mock.
 */

import { useEffect, useState } from 'react';

import { hdxServer } from '@/api';

type SessionRole = { role: string | null; readOnly: boolean };

let answered: boolean | undefined;

async function fetchReadOnly(): Promise<boolean> {
  if (answered !== undefined) {
    return answered;
  }
  try {
    const session = await hdxServer('dfe/session').json<SessionRole>();
    answered = session.readOnly === true;
    return answered;
  } catch {
    return false;
  }
}

/** True once the session is known to be read-only, false until then. */
export function useDfeReadOnly(): boolean {
  const [readOnly, setReadOnly] = useState(answered ?? false);

  useEffect(() => {
    let live = true;
    fetchReadOnly().then(value => {
      if (live) {
        setReadOnly(value);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  return readOnly;
}

/** Style props that take a write action off the page for a read-only session. */
export function useDfeWriteActionProps(): { display?: 'none' } {
  return useDfeReadOnly() ? { display: 'none' } : {};
}

/** Test seam: forget the answer a previous session gave. */
export function resetReadOnlyAnswer(): void {
  answered = undefined;
}
