/**
 * Fork-local coverage for the DFE embed framing policy.
 *
 * The claim being defended is the one the old assertion could not make: the
 * header value follows DFE_EMBED_FRAME_ANCESTORS as the running process sees
 * it, so a container started with an origin answers with that origin. Asserting
 * the config SOURCE passed whether or not a deployment could change anything.
 *
 * The served response is checked separately by dfe-infra's hyperdx-embed smoke
 * check, which curls a running container.
 */
import { EMBED_CSP_HEADER, embedFrameAncestors } from '@/dfe/embedCsp';

describe('embedFrameAncestors', () => {
  const original = process.env.DFE_EMBED_FRAME_ANCESTORS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.DFE_EMBED_FRAME_ANCESTORS;
    } else {
      process.env.DFE_EMBED_FRAME_ANCESTORS = original;
    }
  });

  it('allows only itself when no origin is configured', () => {
    delete process.env.DFE_EMBED_FRAME_ANCESTORS;
    expect(embedFrameAncestors()).toBe("frame-ancestors 'self'");
  });

  it('adds the origin the process was started with', () => {
    process.env.DFE_EMBED_FRAME_ANCESTORS = 'http://localhost:3000';
    expect(embedFrameAncestors()).toBe(
      "frame-ancestors 'self' http://localhost:3000",
    );
  });

  it('follows a change to the variable with no reload of this module', () => {
    process.env.DFE_EMBED_FRAME_ANCESTORS = 'http://localhost:3000';
    expect(embedFrameAncestors()).toBe(
      "frame-ancestors 'self' http://localhost:3000",
    );

    process.env.DFE_EMBED_FRAME_ANCESTORS = 'https://dfe.example.test';
    expect(embedFrameAncestors()).toBe(
      "frame-ancestors 'self' https://dfe.example.test",
    );
  });

  it('carries every origin in a space-separated allowlist', () => {
    expect(
      embedFrameAncestors('https://a.example.test https://b.example.test'),
    ).toBe(
      "frame-ancestors 'self' https://a.example.test https://b.example.test",
    );
  });

  // An operator who unsets the variable in a values file leaves an empty
  // string, not an absent one, and 'frame-ancestors self ' is not a policy.
  it.each(['', '   ', '\n'])(
    'treats a blank value (%j) as no extra origin',
    value => {
      expect(embedFrameAncestors(value)).toBe("frame-ancestors 'self'");
    },
  );
});

describe('EMBED_CSP_HEADER', () => {
  it('names the header the allowlist has to travel in', () => {
    expect(EMBED_CSP_HEADER).toBe('Content-Security-Policy');
  });
});
