/**
 * The cold-start source preference, and its precedence against upstream's.
 *
 * `getDefaultSourceId` is upstream's, so the cases below drive it rather than
 * `dfePreferredSourceId` alone -- the thing worth pinning is that our
 * preference slots in BELOW the user's last selection and above upstream's
 * "first searchable source" fallback, not that a find() works.
 */
import { SourceKind } from '@hyperdx/common-utils/dist/types';

import { getDefaultSourceId } from '@/DBSearchPage';
import { dfePreferredSourceId } from '@/dfe/defaultSource';

const SOURCES = [
  { id: 'default-id', kind: SourceKind.Log, name: 'default', disabled: false },
  { id: 'hunts-id', kind: SourceKind.Log, name: 'hunts', disabled: false },
  { id: 'otel-id', kind: SourceKind.Log, name: 'otel_logs', disabled: false },
];

describe('dfePreferredSourceId', () => {
  it('finds the hunts source by name, whatever its id', () => {
    expect(dfePreferredSourceId(SOURCES)).toBe('hunts-id');
  });

  it('matches case-insensitively', () => {
    expect(dfePreferredSourceId([{ id: 'x', name: 'Hunts' }])).toBe('x');
  });

  it('yields to the caller when no such source exists', () => {
    expect(
      dfePreferredSourceId([{ id: 'a', name: 'default' }]),
    ).toBeUndefined();
  });

  it('yields on a source with no name', () => {
    expect(dfePreferredSourceId([{ id: 'a' }])).toBeUndefined();
  });
});

describe('getDefaultSourceId with the DFE preference', () => {
  it('opens on hunts rather than the first source in the list', () => {
    expect(getDefaultSourceId(SOURCES, undefined)).toBe('hunts-id');
  });

  it('still lets the user last selection win', () => {
    expect(getDefaultSourceId(SOURCES, 'otel-id')).toBe('otel-id');
  });

  // A stale id from another team or a deleted source must not strand the page.
  it('falls back to hunts when the last selection no longer exists', () => {
    expect(getDefaultSourceId(SOURCES, 'gone')).toBe('hunts-id');
  });

  it('keeps upstream ordering when the deployment has no hunts source', () => {
    const noHunts = SOURCES.filter(s => s.id !== 'hunts-id');
    expect(getDefaultSourceId(noHunts, undefined)).toBe('default-id');
  });

  it('never selects a disabled hunts source', () => {
    const disabledHunts = SOURCES.map(s =>
      s.id === 'hunts-id' ? { ...s, disabled: true } : s,
    );
    expect(getDefaultSourceId(disabledHunts, undefined)).toBe('default-id');
  });
});
