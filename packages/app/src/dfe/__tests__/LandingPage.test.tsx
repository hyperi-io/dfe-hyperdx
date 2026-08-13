/**
 * Fork-local coverage for the landing redirect.
 *
 * loginHook whitelists '/', so this component is the only thing that routes an
 * unauthenticated auth-mode visitor off the loading blocker. If the redirect
 * regresses the symptom is an infinite "Loading DFE.." screen.
 */
import { render } from '@testing-library/react';

import LandingPage from '@/dfe/components/LandingPage';

const push = jest.fn();
jest.mock('next/router', () => ({
  useRouter: () => ({ push }),
}));

const useInstallation = jest.fn();
const useTeam = jest.fn();
jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useInstallation: () => useInstallation(),
    useTeam: () => useTeam(),
  },
}));

jest.mock('@/AuthLoadingBlocker', () => ({
  __esModule: true,
  default: () => null,
}));

describe('LandingPage', () => {
  beforeEach(() => {
    push.mockClear();
  });

  it('routes a logged-in user to /search', () => {
    useInstallation.mockReturnValue({ data: undefined, isLoading: true });
    useTeam.mockReturnValue({ data: { name: 'team' }, isLoading: false });
    render(<LandingPage />);
    expect(push).toHaveBeenCalledWith('/search');
  });

  it('routes no-session + existing team to /login', () => {
    useInstallation.mockReturnValue({
      data: { isTeamExisting: true },
      isLoading: false,
    });
    useTeam.mockReturnValue({ data: undefined, isLoading: false });
    render(<LandingPage />);
    expect(push).toHaveBeenCalledWith('/login');
  });

  it('routes no-session + fresh install to /register', () => {
    useInstallation.mockReturnValue({
      data: { isTeamExisting: false },
      isLoading: false,
    });
    useTeam.mockReturnValue({ data: undefined, isLoading: false });
    render(<LandingPage />);
    expect(push).toHaveBeenCalledWith('/register');
  });

  it('stays on the blocker while queries are loading', () => {
    useInstallation.mockReturnValue({ data: undefined, isLoading: true });
    useTeam.mockReturnValue({ data: undefined, isLoading: true });
    render(<LandingPage />);
    expect(push).not.toHaveBeenCalled();
  });
});
