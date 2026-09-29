// DFE User Provisioning
// Find-or-create users from OIDC identity headers.
// This is a NEW controller — it does not modify any upstream HyperDX files.

import type { ObjectId } from '@/models';
import User, { type UserDocument } from '@/models/user';
import logger from '@/utils/logger';

// MongoDB duplicate-key error code, raised when two concurrent inserts collide
// on a unique index (here `email_1`). FerretDB surfaces the same code.
const DUPLICATE_KEY = 11000;

function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: number }).code === DUPLICATE_KEY
  );
}

/**
 * Find an existing user by email, or create one on the given team.
 * Called by the identity middleware on each request.
 *
 * Matched on email ALONE, not `{email, team}`: the User model's unique index is
 * `email_1` (email-only), so a user exists in exactly one team globally and a
 * team-scoped find would miss an existing user and then collide on insert.
 *
 * Race-safe: the middleware fires several requests at once on first login
 * (the iframe loads team + sources + connections together), so a plain
 * find-then-create had every request miss the find and then collide on the
 * unique index -> duplicate-key 500. We keep the create path and treat a
 * concurrent-insert 11000 as "someone else won" - re-read and return the winner.
 *
 * The email is lowercased to match the User model's convention
 * (passport-local-mongoose lowercases emails via usernameLowerCase: true).
 */
export async function findOrCreateUserFromOIDC(
  email: string,
  teamId: ObjectId,
  name?: string,
) {
  const normalizedEmail = email.toLowerCase();

  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    return { user: existing, created: false };
  }

  try {
    const user = new User({
      email: normalizedEmail,
      name: name || normalizedEmail.split('@')[0],
      team: teamId,
    });
    await user.save();

    logger.info(
      { userId: user._id, email: normalizedEmail, teamId },
      'DFE: provisioned new user from OIDC',
    );

    return { user, created: true };
  } catch (err) {
    if (isDuplicateKey(err)) {
      const winner = await User.findOne({ email: normalizedEmail });
      if (winner) {
        return { user: winner, created: false };
      }
    }
    throw err;
  }
}

/**
 * Move an existing user onto the team the engine's decision selects.
 *
 * Upstream never moves a user off the team it was created on, so without this a
 * user whose engine groups changed would keep the old team's connection, and
 * with it that team's ClickHouse access.
 */
export async function placeUserOnTeam(
  user: UserDocument,
  teamId: ObjectId,
): Promise<void> {
  if (String(user.team) === String(teamId)) {
    return;
  }
  await User.updateOne({ _id: user._id }, { $set: { team: teamId } });
  logger.info(
    { userId: user._id, from: user.team, to: teamId },
    'DFE: moved user to the team the engine selects',
  );
  user.team = teamId;
}
