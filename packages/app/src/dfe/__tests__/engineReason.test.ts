import { engineReason } from '@/dfe/components/CreateRuleFromSearch';

jest.mock('@/api', () => ({ hdxServer: jest.fn() }));
jest.mock('@mantine/notifications', () => ({
  notifications: { show: jest.fn() },
}));
jest.mock('@/config', () => ({ DFE_UI_BASE_URL: 'http://dfe-ui.test' }));

const STATUS_LINE = 'Request failed with status code 422';

// jsdom ships no Response, so this one carries the two members engineReason
// uses and, like the real one, serves its body once per clone.
class FakeResponse {
  constructor(private readonly text: string) {}

  clone() {
    return new FakeResponse(this.text);
  }

  async json() {
    return JSON.parse(this.text);
  }
}

const httpError = (body: string) => ({
  message: STATUS_LINE,
  response: new FakeResponse(body),
});

const json = (body: unknown) => JSON.stringify(body);

describe('engineReason', () => {
  it.each([
    ['a message', json({ message: 'Name is too long' }), 'Name is too long'],
    [
      'a message ahead of a detail',
      json({ message: 'From message', detail: 'From detail' }),
      'From message',
    ],
    [
      'a string detail',
      json({
        detail:
          'Rule not saved: Rule has empty detection logic (WHERE clause).',
      }),
      'Rule not saved: Rule has empty detection logic (WHERE clause).',
    ],
    [
      'a list detail',
      json({
        detail: [
          { msg: 'Field required', loc: ['body', 'raw_sql'] },
          { msg: 'Input should be a valid string', loc: ['body', 'source'] },
        ],
      }),
      'Field required; Input should be a valid string',
    ],
    [
      'a list detail with entries that carry no msg',
      json({ detail: [{ loc: ['body'] }, 'text', null, { msg: 'Kept' }] }),
      'Kept',
    ],
    ['an empty message and no detail', json({ message: '' }), STATUS_LINE],
    ['an empty detail', json({ detail: '' }), STATUS_LINE],
    ['an empty detail list', json({ detail: [] }), STATUS_LINE],
    ['a detail that is neither', json({ detail: 7 }), STATUS_LINE],
    ['a body that is not JSON', '<html>bad</html>', STATUS_LINE],
    ['an empty body', '', STATUS_LINE],
    ['a JSON null', 'null', STATUS_LINE],
  ])('%s', async (_name, body, expected) => {
    await expect(engineReason(httpError(body))).resolves.toBe(expected);
  });
});
