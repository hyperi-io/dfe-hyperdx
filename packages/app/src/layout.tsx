import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Button, Center, Group, Text } from '@mantine/core';
import { useIsomorphicEffect } from '@mantine/hooks';
import { IconX } from '@tabler/icons-react';

// INTERIM (2.29 merge): use upstream's AppNav. The DFE nav (@/dfe/components/AppNav
// + SidebarMenu/HyperDxNavItems) drifted hard against 2.29 (use-query-params->nuqs,
// removed @/types SavedSearch/ServerDashboard, Mantine Collapse) and is being
// replaced by the config-driven condensed embed nav. Re-point once that lands.
import AppNav from '@/components/AppNav';
import { IS_CLICKHOUSE_BUILD } from '@/config';
import { isEmbedChrome } from '@/dfe/embedFeatures';

import { HDXSpotlightProvider } from './Spotlights';
import { useLocalStorage } from './utils';

/**
 * Next.js layout for pages that use the AppNav component. Using the same layout
 * for all pages that use the AppNav component ensures that the AppNav state, such as
 * scroll position, input values, etc. is preserved when navigating between pages.
 *
 * https://nextjs.org/docs/pages/building-your-application/routing/pages-and-layouts
 *
 * @example SearchPage.getLayout = withAppNav;
 */
function PageWrapper({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [bannerState, setBannerState] = useLocalStorage(
    'clickstack-banner-state',
    'opened',
  );
  const [hasMounted, setHasMounted] = React.useState(false); // prevents banner flash
  React.useEffect(() => setHasMounted(true), []);

  // DFE embed (chromeless) mode: when embedded in dfe-ui (?embed=1) dfe-ui owns the
  // nav, so hyperdx renders NO AppNav. The flip runs in an isomorphic layout effect
  // so it lands before paint - a plain useEffect flashed the AppNav for one frame.
  // Both SSR and the first client render start false, so hydration still matches.
  const [isEmbed, setIsEmbed] = React.useState(false);
  useIsomorphicEffect(() => setIsEmbed(isEmbedChrome()), []);

  const kioskQueryValue = router.query.kiosk;
  const isDashboardKioskMode =
    (router.pathname === '/dashboards' ||
      router.pathname === '/dashboards/[dashboardId]') &&
    (kioskQueryValue === 'true' ||
      (Array.isArray(kioskQueryValue) && kioskQueryValue.includes('true')));
  const bannerIsActive =
    hasMounted &&
    !isDashboardKioskMode &&
    IS_CLICKHOUSE_BUILD &&
    bannerState === 'opened';

  React.useEffect(() => {
    window.dispatchEvent(new Event('resize'));
  }, [isDashboardKioskMode]);

  return (
    <div className={bannerIsActive ? 'app-layout-with-banner' : 'app-layout'}>
      {bannerIsActive && (
        <Group bg="var(--color-text-primary)">
          <Center style={{ flexGrow: 1 }}>
            <Text py="xs" size="sm" c="var(--color-text-inverted)">
              This is not recommended for production use and is lacking core
              ClickStack features such as alerts and saved searches. For a
              proper experience, visit the{' '}
              <strong>
                <Link
                  href="https://clickhouse.com/docs/use-cases/observability/clickstack/getting-started"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ClickStack Docs
                </Link>
              </strong>
            </Text>
          </Center>
          <Button
            onClick={() => setBannerState('closed')}
            variant="transparent"
            color="var(--color-text-inverted)"
          >
            <IconX />{' '}
          </Button>
        </Group>
      )}
      <div className="d-flex" style={{ height: '100%', overflow: 'hidden' }}>
        {/* dfe-appnav-slot is display:contents (layout-transparent) so AppNav stays
            a direct flex child; the embed init script in _document hides it before
            paint via `html.dfe-embed .dfe-appnav-slot`, killing the chrome flash the
            post-hydration React removal below cannot reach on an SSR paint. */}
        {!isEmbed && !isDashboardKioskMode && (
          <div className="dfe-appnav-slot">
            <AppNav />
          </div>
        )}
        <div
          id="app-content-scroll-container"
          className="w-100 min-w-0"
          style={{
            minWidth: 0,
            overflowX: 'auto',
            overflowY: 'scroll',
            scrollbarGutter: 'stable',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export const withAppNav = (page: React.ReactNode): React.ReactNode => {
  return (
    <HDXSpotlightProvider>
      <PageWrapper>{page}</PageWrapper>
    </HDXSpotlightProvider>
  );
};
