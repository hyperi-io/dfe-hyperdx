/**
 * The engine is asked whether the search makes a valid rule before Create Rule
 * can be pressed. A refusal is shown in plain words with the button off, any
 * other answer leaves the button on, and no rule is written by the question.
 */
import { ChartConfig } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { render, screen, waitFor } from '@testing-library/react';

import { hdxServer } from '@/api';
import { CreateRuleFromSearch } from '@/dfe/components/CreateRuleFromSearch';
import { resetReadOnlyAnswer } from '@/dfe/readOnlySession';
import { resetRuleCheck } from '@/dfe/useRuleCheck';

jest.mock('@/api', () => ({ hdxServer: jest.fn() }));
jest.mock('@mantine/notifications', () => ({
  notifications: { show: jest.fn() },
}));
jest.mock('@/config', () => ({ DFE_UI_BASE_URL: 'http://dfe-ui.test' }));
jest.mock('ky', () => ({
  HTTPError: class HTTPError extends Error {
    constructor(public response: { status: number; clone: () => unknown }) {
      super('http error');
    }
  },
}));

import { HTTPError } from 'ky';

const hdxServerMock = hdxServer as unknown as jest.Mock;
const CONFIG = { source: 's1', select: '_timestamp,_json' } as ChartConfig;

const refusedWith = (status: number, body: unknown) => {
  const response = {
    status,
    clone: () => ({ json: () => Promise.resolve(body) }),
  };
  return new (HTTPError as unknown as new (r: unknown) => Error)(response);
};

/** Route each call by its path, as the page's server would. */
function engineAnswers(
  createRule: () => Promise<unknown>,
  status: number = 200,
) {
  hdxServerMock.mockImplementation((path: string) => {
    if (path === 'dfe/session') {
      return { json: () => Promise.resolve({ readOnly: false }) };
    }
    if (path === 'dfe/export-sql') {
      return { json: () => Promise.resolve({ rawSql: 'SELECT 1' }) };
    }
    // Awaiting the call gives the status and rejects on a refusal, as ky does.
    const answer = createRule();
    const awaited = answer.then(() => ({ status }));
    awaited.catch(() => undefined);
    return Object.assign(awaited, { json: () => answer });
  });
}

const renderButton = () =>
  render(
    <MantineProvider>
      <CreateRuleFromSearch chartConfig={CONFIG} sourceId="s1" />
    </MantineProvider>,
  );

const createCalls = () =>
  hdxServerMock.mock.calls.filter(([path]) => path === 'dfe/create-rule');

beforeEach(() => {
  resetReadOnlyAnswer();
  resetRuleCheck();
  hdxServerMock.mockReset();
});

describe('Create Rule pre-check', () => {
  it('asks the engine with a dry run and enables Create for a valid search', async () => {
    engineAnswers(() => Promise.resolve({ id: 'r', display_name: 'R' }));

    renderButton();

    const button = screen.getByTestId('create-rule-from-search-button');
    await waitFor(() => expect(button).toBeEnabled());
    expect(createCalls()).toHaveLength(1);
    expect(createCalls()[0][1].searchParams).toEqual({ dry_run: 'true' });
    expect(screen.queryByTestId('create-rule-precheck')).toBeNull();
  });

  it('shows a time-only search in plain words, lists the bounds and disables Create', async () => {
    engineAnswers(() =>
      Promise.reject(
        refusedWith(422, {
          code: 'rule_empty_filter',
          detail: 'Rule not saved: ...',
          dropped_bounds: ['_timestamp_load < now()'],
        }),
      ),
    );

    renderButton();

    const message = await screen.findByTestId('create-rule-precheck');
    expect(message).toHaveTextContent('This search only filters on time.');
    expect(message).toHaveTextContent('The hunt sets its own time window.');
    expect(message).toHaveTextContent('_timestamp_load < now()');
    expect(screen.getByTestId('create-rule-from-search-button')).toBeDisabled();
  });

  it("shows the engine's detail for any other refusal", async () => {
    engineAnswers(() =>
      Promise.reject(
        refusedWith(422, {
          code: 'invalid_sql',
          detail: 'Rule not saved: unknown column nosuchcol',
        }),
      ),
    );

    renderButton();

    expect(await screen.findByTestId('create-rule-precheck')).toHaveTextContent(
      'unknown column nosuchcol',
    );
    expect(screen.getByTestId('create-rule-from-search-button')).toBeDisabled();
  });

  it.each([
    ['the engine is unreachable (502)', 502, { error: 'no credential' }],
    ['the answer is not a refusal', 422, { detail: 'no code here' }],
  ])('leaves Create on when %s', async (_name, status, body) => {
    engineAnswers(() => Promise.reject(refusedWith(status, body)));

    renderButton();

    await waitFor(() => expect(createCalls()).toHaveLength(1));
    await waitFor(() =>
      expect(
        screen.getByTestId('create-rule-from-search-button'),
      ).toBeEnabled(),
    );
    expect(screen.queryByTestId('create-rule-precheck')).toBeNull();
  });

  it('leaves Create on, and stops asking, when the engine saved the rule instead', async () => {
    engineAnswers(() => Promise.resolve({ id: 'r', display_name: 'R' }), 201);

    const { rerender } = renderButton();

    await waitFor(() => expect(createCalls()).toHaveLength(1));
    await waitFor(() =>
      expect(
        screen.getByTestId('create-rule-from-search-button'),
      ).toBeEnabled(),
    );
    rerender(
      <MantineProvider>
        <CreateRuleFromSearch
          chartConfig={{ ...CONFIG, select: '_json' } as ChartConfig}
          sourceId="s1"
        />
      </MantineProvider>,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('create-rule-from-search-button'),
      ).toBeEnabled(),
    );
    expect(createCalls()).toHaveLength(1);
  });
});
