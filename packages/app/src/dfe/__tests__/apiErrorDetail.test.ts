import type { HTTPError } from 'ky';

import { dfeApiErrorDetail } from '@/dfe/apiErrorDetail';

const STATUS_LINE = 'Request failed with status code 400 Bad Request';

// jsdom ships no Response, so this one carries the three members the hook
// uses and, like the real one, serves its body once per clone.
class FakeResponse {
  private used = false;

  constructor(
    private readonly text: string,
    readonly status: number,
  ) {}

  clone() {
    return new FakeResponse(this.text, this.status);
  }

  async json() {
    if (this.used) {
      throw new TypeError('body used already');
    }
    this.used = true;
    return JSON.parse(this.text);
  }
}

const httpError = (status: number, body: string): HTTPError =>
  Object.assign(new Error(STATUS_LINE), {
    response: new FakeResponse(body, status),
  }) as unknown as HTTPError;

const json = (body: unknown) => JSON.stringify(body);

describe('dfeApiErrorDetail', () => {
  it.each([
    [
      'a route message',
      400,
      json({ message: 'Name is too long' }),
      'Name is too long',
    ],
    [
      'a schema rejection',
      422,
      json([
        {
          errors: {
            issues: [
              { message: 'name: Required' },
              { message: 'tiles: Expected array' },
            ],
          },
        },
      ]),
      'name: Required; tiles: Expected array',
    ],
    [
      'the fork refusal shape',
      403,
      json({ error: 'Your role is read-only, so it cannot change this.' }),
      'Your role is read-only, so it cannot change this.',
    ],
    ['an empty message', 400, json({ message: '' }), STATUS_LINE],
    ['a body that is not JSON', 400, '<html>bad</html>', STATUS_LINE],
    ['an unrecognised JSON body', 400, json({ code: 7 }), STATUS_LINE],
    [
      'a server error',
      500,
      json({ message: 'Something went wrong :(' }),
      STATUS_LINE,
    ],
  ])('%s', async (_name, status, body, expected) => {
    const err = await dfeApiErrorDetail(httpError(status, body));
    expect(err.message).toBe(expected);
  });

  it('leaves the response body readable for the caller', async () => {
    const err = await dfeApiErrorDetail(
      httpError(400, json({ message: 'Name is too long' })),
    );
    await expect(err.response.json()).resolves.toEqual({
      message: 'Name is too long',
    });
  });

  it('passes an error with no response through untouched', async () => {
    const err = new Error('boom') as unknown as HTTPError;
    await expect(dfeApiErrorDetail(err)).resolves.toBe(err);
    expect(err.message).toBe('boom');
  });
});
