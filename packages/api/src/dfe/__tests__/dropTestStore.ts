import mongoose from 'mongoose';

/**
 * Drops the test database and disconnects once every model's index builds
 * have settled. `connect()` starts those builds without awaiting them, and a
 * drop that overtakes one deadlocks on DocumentDB, as `closeDB` in fixtures.ts
 * guards against.
 */
export async function dropTestStore() {
  await Promise.all(
    Object.values(mongoose.models).map(model =>
      model.init().catch(() => undefined),
    ),
  );
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}
