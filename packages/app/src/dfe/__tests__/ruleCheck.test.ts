import { parseRefusal, refusalCopy, RULE_EMPTY_FILTER } from '@/dfe/ruleCheck';

describe('parseRefusal', () => {
  it.each([
    [
      'an empty filter with its bounds',
      {
        code: RULE_EMPTY_FILTER,
        detail: 'Rule not saved: ...',
        dropped_bounds: ['_timestamp_load < now()'],
      },
      {
        code: RULE_EMPTY_FILTER,
        detail: 'Rule not saved: ...',
        droppedBounds: ['_timestamp_load < now()'],
      },
    ],
    [
      'another code keeps its detail',
      { code: 'invalid_sql', detail: 'Unknown identifier nosuchcol' },
      {
        code: 'invalid_sql',
        detail: 'Unknown identifier nosuchcol',
        droppedBounds: [],
      },
    ],
    [
      'bounds that are not strings are dropped',
      { code: RULE_EMPTY_FILTER, dropped_bounds: ['a', 7, null] },
      { code: RULE_EMPTY_FILTER, detail: '', droppedBounds: ['a'] },
    ],
  ])('%s', (_name, body, expected) => {
    expect(parseRefusal(body)).toEqual(expected);
  });

  it.each([
    ['no code', { detail: 'x' }],
    ['a list', [{ code: 'x' }]],
    ['null', null],
    ['text', 'Unprocessable'],
  ])('is not a refusal with %s', (_name, body) => {
    expect(parseRefusal(body)).toBeUndefined();
  });
});

describe('refusalCopy', () => {
  it('says a time-only search only filters on time and lists the bounds', () => {
    const copy = refusalCopy({
      code: RULE_EMPTY_FILTER,
      detail: '',
      droppedBounds: ['_timestamp_load < now()'],
    });

    expect(copy.summary).toBe('This search only filters on time.');
    expect(copy.explanation).toContain('such as a field match');
    expect(copy.explanation).toContain('The hunt sets its own time window.');
    expect(copy.bounds).toEqual(['_timestamp_load < now()']);
  });

  it('says a search with nothing left has no filter', () => {
    const copy = refusalCopy({
      code: RULE_EMPTY_FILTER,
      detail: '',
      droppedBounds: [],
    });

    expect(copy.summary).toBe('This search has no filter.');
    expect(copy.bounds).toEqual([]);
  });

  it('shows the engine detail for any other code', () => {
    expect(
      refusalCopy({
        code: 'invalid_sql',
        detail: 'Rule not saved: unknown column nosuchcol',
        droppedBounds: [],
      }),
    ).toEqual({
      summary: 'Rule not saved: unknown column nosuchcol',
      explanation: '',
      bounds: [],
    });
  });
});
