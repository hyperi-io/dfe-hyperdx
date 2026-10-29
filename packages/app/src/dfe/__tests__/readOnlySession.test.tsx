/**
 * A read-only session is not offered Save, Update or Create Rule, and any other
 * session (an editor, a standalone deployment with no /dfe/session route, an
 * answer that never arrives) keeps all three.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import { render, renderHook, screen, waitFor } from '@testing-library/react';

import { hdxServer } from '@/api';
import { CreateRuleFromSearch } from '@/dfe/components/CreateRuleFromSearch';
import {
  resetReadOnlyAnswer,
  useDfeReadOnly,
  useDfeWriteActionProps,
} from '@/dfe/readOnlySession';

jest.mock('@/api', () => ({ hdxServer: jest.fn() }));
jest.mock('@mantine/notifications', () => ({
  notifications: { show: jest.fn() },
}));
jest.mock('@/config', () => ({ DFE_UI_BASE_URL: 'http://dfe-ui.test' }));

const hdxServerMock = hdxServer as unknown as jest.Mock;

const answers = (body: unknown) =>
  hdxServerMock.mockReturnValue({ json: () => Promise.resolve(body) });

const refuses = (status: number) =>
  hdxServerMock.mockReturnValue({
    json: () => Promise.reject(new Error(`HTTP ${status}`)),
  });

beforeEach(() => {
  resetReadOnlyAnswer();
  hdxServerMock.mockReset();
});

describe('useDfeReadOnly', () => {
  it.each([
    ['a viewer', { role: 'viewer', readOnly: true }, true],
    ['a member', { role: 'member', readOnly: false }, false],
    ['an admin', { role: 'admin', readOnly: false }, false],
    ['a session with no role', { role: null, readOnly: false }, false],
  ])('%s', async (_name, body, expected) => {
    answers(body);

    const { result } = renderHook(() => useDfeReadOnly());

    await waitFor(() => expect(result.current).toBe(expected));
    expect(hdxServerMock).toHaveBeenCalledWith('dfe/session');
  });

  it('keeps the actions when the deployment has no /dfe/session route', async () => {
    refuses(404);

    const { result } = renderHook(() => useDfeReadOnly());

    await waitFor(() => expect(hdxServerMock).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('keeps the actions when the request throws before it is sent', async () => {
    hdxServerMock.mockImplementation(() => {
      throw new Error('no client');
    });

    const { result } = renderHook(() => useDfeReadOnly());

    await waitFor(() => expect(hdxServerMock).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});

describe('useDfeWriteActionProps', () => {
  it.each([
    [{ role: 'viewer', readOnly: true }, { display: 'none' }],
    [{ role: 'member', readOnly: false }, {}],
  ])('%j gives %j', async (body, props) => {
    answers(body);

    const { result } = renderHook(() => useDfeWriteActionProps());

    await waitFor(() => expect(result.current).toEqual(props));
  });
});

describe('CreateRuleFromSearch', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MantineProvider>{children}</MantineProvider>
  );
  const button = () => screen.getByTestId('create-rule-from-search-button');

  it('is drawn for an editor', async () => {
    answers({ role: 'member', readOnly: false });

    render(<CreateRuleFromSearch chartConfig={null} />, { wrapper });

    await waitFor(() => expect(hdxServerMock).toHaveBeenCalled());
    expect(button()).toBeVisible();
  });

  it('is not drawn for a read-only session', async () => {
    answers({ role: 'viewer', readOnly: true });

    render(<CreateRuleFromSearch chartConfig={null} />, { wrapper });

    await waitFor(() => expect(button()).not.toBeVisible());
  });
});

describe('DBSearchPage wiring', () => {
  // The page is too heavy to render here, and an upstream sync can drop a
  // one-line delta while the merge still applies cleanly.
  const page = readFileSync(join(__dirname, '../../DBSearchPage.tsx'), 'utf-8');

  it('spreads the write-action props on both the Save and the Update button', () => {
    expect(page).toContain("from '@/dfe/readOnlySession'");
    expect(page).toContain('useDfeWriteActionProps()');
    for (const testId of ['save-search-button', 'update-search-button']) {
      const button = page.slice(page.indexOf(`data-testid="${testId}"`));
      const opening = button.slice(0, button.indexOf('</Button>'));
      expect(opening).toContain('{...dfeWriteActionProps}');
    }
  });
});
