import { useEffect } from 'react';
import { useRouter } from 'next/router';

import api from '@/api';
import AuthLoadingBlocker from '@/AuthLoadingBlocker';
import { IS_LOCAL_MODE } from '@/config';

export default function LandingPage() {
  const { data: installation, isLoading: installationIsLoading } =
    api.useInstallation();
  const { data: team, isLoading: teamIsLoading } = api.useTeam();
  const router = useRouter();

  const isLoggedIn = Boolean(!teamIsLoading && team);

  useEffect(() => {
    if (isLoggedIn || IS_LOCAL_MODE) {
      router.push('/search');
    } else if (!teamIsLoading && !installationIsLoading && installation) {
      // Auth mode, no session: loginHook whitelists '/', so this page owns
      // the redirect. First run (no team yet) goes to registration.
      router.push(installation.isTeamExisting ? '/login' : '/register');
    }
  }, [isLoggedIn, router, teamIsLoading, installationIsLoading, installation]);

  return <AuthLoadingBlocker />;
}
