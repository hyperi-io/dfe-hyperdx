/**
 * A request body cannot write through mongoose into Object.prototype.toString.
 *
 * GHSA-8332-j7wj-wjw4: mongoose before 6.13.12 follows inherited properties when
 * it merges an update or sets a dotted path, so a body key named `toString`
 * overwrites Object.prototype.toString.call and every later query in the process
 * throws. The dashboard and saved-search routes pass the unstripped body to these
 * calls, so the fix arrives through the `mongoose` entry in
 * security/overrides.yaml and this test fails when that pin is lost.
 *
 * The cases only build queries and documents. Nothing connects to MongoDB.
 */
import mongoose from 'mongoose';

import Dashboard from '@/models/dashboard';
import { SavedSearch } from '@/models/savedSearch';

const id = new mongoose.Types.ObjectId();
const nativeCall = Object.prototype.toString.call;

describe('mongoose and inherited body keys', () => {
  test.each([
    [
      'PATCH /dashboards/:id update',
      () =>
        Dashboard.findOneAndUpdate(
          { _id: id, team: id },
          {
            ...JSON.parse('{"name":"d","toString":{"call":1}}'),
            updatedBy: id,
          },
          { new: true },
        ),
    ],
    [
      'PATCH /saved-search/:id update',
      () =>
        SavedSearch.findOneAndUpdate(
          { _id: id, team: id },
          { ...JSON.parse('{"name":"s","toString":{"call":1}}'), team: id },
          { new: true },
        ),
    ],
    [
      'POST /dashboards document with a dotted Mixed path',
      () =>
        new Dashboard({
          ...JSON.parse(
            '{"name":"d","tiles":[],"savedDateRange.toString.call":1}',
          ),
          team: id,
        }),
    ],
  ])('%s leaves Object.prototype.toString.call alone', (_name, build) => {
    let call: unknown;
    try {
      build();
    } finally {
      call = Object.prototype.toString.call;
      // Inside the test, because jest itself calls toString.call before every
      // hook, so an afterEach would never run on a polluted built-in.
      Reflect.deleteProperty(Object.prototype.toString, 'call');
    }
    expect(call).toBe(nativeCall);
  });
});
