/**
 * The engine is asked whether the search makes a valid rule before Create Rule
 * can be pressed, through the route that writes nothing. A refusal turns the
 * button off and is explained when asked, any other answer leaves the button on,
 * and the create route is called only by a click on Create Rule.
 */
import {
  ChartConfig,
  ChartConfigWithDateRange,
} from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { UserEvent } from '@testing-library/user-event';

import { hdxServer } from '@/api';
import { CreateRuleFromSearch } from '@/dfe/components/CreateRuleFromSearch';
import { resetReadOnlyAnswer } from '@/dfe/readOnlySession';
import { resetRuleCheck } from '@/dfe/useRuleCheck';

jest.mock('@/api', () => ({ hdxServer: jest.fn() }));
jest.mock('@mantine/notifications', () => ({
  notifications: { show: jest.fn() },
}));
jest.mock('@/config', () => ({ DFE_UI_BASE_URL: 'http://dfe-ui.test' }));
const hdxServerMock = hdxServer as unknown as jest.Mock;
const CONFIG = { source: 's1', select: '_timestamp,_json' } as ChartConfig;

const refusedWith = (status: number, body: unknown) => {
  // The shape of a ky HTTPError, which the code reads without its class.
  const response = {
    status,
    clone: () => ({ json: () => Promise.resolve(body) }),
  };
  return Object.assign(new Error('http error'), { response });
};

/** Route each call by its path, as the page's server would. */
function engineAnswers(
  validate: () => Promise<unknown>,
  session: () => Promise<unknown> = () => Promise.resolve({ readOnly: false }),
) {
  hdxServerMock.mockImplementation((path: string) => {
    if (path === 'dfe/session') {
      return { json: session };
    }
    if (path === 'dfe/export-sql') {
      return { json: () => Promise.resolve({ rawSql: 'SELECT 1' }) };
    }
    const answer =
      path === 'dfe/validate-rule' ? validate() : Promise.resolve({});
    answer.catch(() => undefined);
    return { json: () => answer };
  });
}

const renderButton = () =>
  render(
    <MantineProvider>
      <CreateRuleFromSearch chartConfig={CONFIG} sourceId="s1" />
    </MantineProvider>,
  );

const callsTo = (route: string) =>
  hdxServerMock.mock.calls.filter(([path]) => path === route);
const validateCalls = () => callsTo('dfe/validate-rule');
const createCalls = () => callsTo('dfe/create-rule');

beforeEach(() => {
  resetReadOnlyAnswer();
  resetRuleCheck();
  hdxServerMock.mockReset();
});

describe('Create Rule pre-check', () => {
  it('asks the validate route and enables Create for a valid search', async () => {
    engineAnswers(() => Promise.resolve({ valid: true }));

    renderButton();

    const button = screen.getByTestId('create-rule-from-search-button');
    await waitFor(() => expect(validateCalls()).toHaveLength(1));
    await waitFor(() => expect(button).toBeEnabled());
    expect(createCalls()).toHaveLength(0);
    expect(screen.queryByTestId('create-rule-precheck')).toBeNull();
  });

  it('asks nothing before the session answers, or after it says read-only', async () => {
    jest.useFakeTimers();
    try {
      let answerSession: (body: unknown) => void = () => undefined;
      const session = new Promise(resolve => {
        answerSession = resolve;
      });
      engineAnswers(
        () => Promise.resolve({ valid: true }),
        () => session,
      );
      const asked = () => [...callsTo('dfe/export-sql'), ...validateCalls()];

      renderButton();

      await jest.advanceTimersByTimeAsync(1000);
      expect(asked()).toHaveLength(0);
      answerSession({ readOnly: true });
      await waitFor(() =>
        expect(
          screen.getByTestId('create-rule-from-search-button'),
        ).not.toBeVisible(),
      );
      await jest.advanceTimersByTimeAsync(1000);
      expect(asked()).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('asks the engine when the session lookup fails, as outside DFE', async () => {
    engineAnswers(
      () => Promise.resolve({ valid: true }),
      () => Promise.reject(new Error('HTTP 404')),
    );

    renderButton();

    await waitFor(() => expect(validateCalls()).toHaveLength(1));
    expect(screen.getByTestId('create-rule-from-search-button')).toBeVisible();
  });

  const emptyFilter = () =>
    engineAnswers(() =>
      Promise.reject(
        refusedWith(422, {
          code: 'rule_empty_filter',
          detail: 'Rule not saved: ...',
          dropped_bounds: ['_timestamp_load < now()'],
        }),
      ),
    );

  const refusedButton = async () => {
    const button = screen.getByTestId('create-rule-from-search-button');
    await screen.findByTestId('create-rule-precheck-hint');
    return button;
  };

  it('shows nothing for a time-only search until the user acts', async () => {
    emptyFilter();

    renderButton();

    const button = await refusedButton();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByTestId('create-rule-precheck')).toBeNull();
  });

  it('ties a short explanation to the button for focus and hover', async () => {
    emptyFilter();
    const user = userEvent.setup();

    renderButton();

    const button = await refusedButton();
    const hint = document.getElementById(
      button.getAttribute('aria-describedby') ?? '',
    );
    expect(hint).toHaveTextContent('This search only filters on time.');
    expect(hint).toHaveTextContent('The hunt sets its own time window.');
    await user.hover(button);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'This search only filters on time.',
    );
  });

  it('opens the full explanation on click, listing the bounds, and writes nothing', async () => {
    emptyFilter();
    const user = userEvent.setup();

    renderButton();

    await user.click(await refusedButton());

    const message = await screen.findByTestId('create-rule-precheck');
    expect(message).toHaveTextContent('This search only filters on time.');
    expect(message).toHaveTextContent('The hunt sets its own time window.');
    expect(message).toHaveTextContent('Left out of the rule:');
    expect(message).toHaveTextContent('_timestamp_load < now()');
    expect(createCalls()).toHaveLength(0);
  });

  it.each([
    ['Escape', (user: UserEvent) => user.keyboard('{Escape}')],
    ['an outside click', (user: UserEvent) => user.click(document.body)],
  ])('closes the explanation on %s', async (_name, act) => {
    emptyFilter();
    const user = userEvent.setup();

    renderButton();

    await user.click(await refusedButton());
    await screen.findByTestId('create-rule-precheck');
    await act(user);

    await waitFor(() =>
      expect(screen.queryByTestId('create-rule-precheck')).toBeNull(),
    );
  });

  it('closes the explanation when the search changes', async () => {
    emptyFilter();
    const user = userEvent.setup();
    const { rerender } = renderButton();

    await user.click(await refusedButton());
    await screen.findByTestId('create-rule-precheck');
    rerender(
      <MantineProvider>
        <CreateRuleFromSearch
          chartConfig={{ ...CONFIG, select: '_json' } as ChartConfig}
          sourceId="s1"
        />
      </MantineProvider>,
    );

    await waitFor(() =>
      expect(screen.queryByTestId('create-rule-precheck')).toBeNull(),
    );
  });

  it("shows the engine's detail for any other refusal when opened", async () => {
    engineAnswers(() =>
      Promise.reject(
        refusedWith(422, {
          code: 'invalid_sql',
          detail: 'Rule not saved: unknown column nosuchcol',
        }),
      ),
    );
    const user = userEvent.setup();

    renderButton();

    await user.click(await refusedButton());
    expect(await screen.findByTestId('create-rule-precheck')).toHaveTextContent(
      'unknown column nosuchcol',
    );
    expect(createCalls()).toHaveLength(0);
  });

  it.each([
    ['the engine is unreachable (502)', 502, { error: 'no credential' }],
    ['the answer is not a refusal', 422, { detail: 'no code here' }],
  ])('leaves Create on when %s', async (_name, status, body) => {
    engineAnswers(() => Promise.reject(refusedWith(status, body)));

    renderButton();

    await waitFor(() => expect(validateCalls()).toHaveLength(1));
    await waitFor(() =>
      expect(
        screen.getByTestId('create-rule-from-search-button'),
      ).toBeEnabled(),
    );
    expect(screen.queryByTestId('create-rule-precheck')).toBeNull();
  });

  it.each([404, 405])(
    'leaves Create on, and stops asking, when the engine answers %s',
    async status => {
      engineAnswers(() => Promise.reject(refusedWith(status, {})));

      const { rerender } = renderButton();

      await waitFor(() => expect(validateCalls()).toHaveLength(1));
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
      expect(validateCalls()).toHaveLength(1);
      expect(createCalls()).toHaveLength(0);
    },
  );

  it('closes the explanation on a time-range change the check ignores', async () => {
    const rangedConfig: ChartConfigWithDateRange = {
      ...CONFIG,
      dateRange: [new Date(0), new Date(1000)],
    };
    emptyFilter();
    const user = userEvent.setup();
    const { rerender } = renderButton();

    await user.click(await refusedButton());
    await screen.findByTestId('create-rule-precheck');
    rerender(
      <MantineProvider>
        <CreateRuleFromSearch chartConfig={rangedConfig} sourceId="s1" />
      </MantineProvider>,
    );

    await waitFor(() =>
      expect(screen.queryByTestId('create-rule-precheck')).toBeNull(),
    );
    expect(validateCalls()).toHaveLength(1);
  });
});
