import Link from 'next/link';
import { useRouter } from 'next/router';
import cx from 'classnames';
import { ActionIcon } from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { IconLayoutSidebarLeftCollapse } from '@tabler/icons-react';

import { SidebarMenu } from '@/dfe/components/SidebarMenu';
import { useLogomark, useWordmark } from '@/theme/ThemeProvider';
import { useWindowSize } from '@/utils';

import { AppNavContext } from './AppNav.components';

import styles from './AppNav.module.scss';

export default function AppNav({ fixed = false }: { fixed?: boolean }) {
  const wordmark = useWordmark();
  const logomark = useLogomark({ size: 22 });

  const router = useRouter();
  const { pathname } = router;

  const { width } = useWindowSize();

  const [isPreferCollapsed, setIsPreferCollapsed] = useLocalStorage<boolean>({
    key: 'isNavCollapsed',
    defaultValue: false,
  });

  const isSmallScreen = (width ?? 1000) < 900;
  const isCollapsed = isSmallScreen || isPreferCollapsed;

  const navWidth = isCollapsed ? 79 : 250;

  return (
    <AppNavContext.Provider value={{ isCollapsed, pathname }}>
      {fixed && (
        <div
          className={styles.navGhost}
          style={{
            width: navWidth + 1,
            minWidth: navWidth + 1,
          }}
        ></div>
      )}
      <div
        className={cx(styles.nav, {
          [styles.navFixed]: fixed,
          [styles.navCollapsed]: isCollapsed,
        })}
        style={{ width: navWidth }}
      >
        <div style={{ width: navWidth }}>
          <div
            className={cx(styles.header, {
              [styles.headerExpanded]: !isCollapsed,
              [styles.headerCollapsed]: isCollapsed,
            })}
          >
            <Link href="/search" className={styles.logoLink}>
              {isCollapsed ? (
                <div className={styles.logoIconWrapper}>{logomark}</div>
              ) : (
                <>{wordmark}</>
              )}
            </Link>
            <span className={styles.hyperiCollapseButton}>
              <ActionIcon
                variant="transparent"
                size="sm"
                className={cx(styles.collapseButton, {
                  [styles.collapseButtonCollapsed]: isCollapsed,
                })}
                title="Collapse/Expand Navigation"
                onClick={() => setIsPreferCollapsed((v: boolean) => !v)}
              >
                <span className={styles.hyperiCollapseButtonIcon}>
                  <IconLayoutSidebarLeftCollapse
                    size={16}
                    style={{ color: 'var(--color-brand-foreground)' }}
                  />
                </span>
              </ActionIcon>
            </span>
          </div>
        </div>
        <SidebarMenu isCollapsed={isCollapsed} />
      </div>
    </AppNavContext.Provider>
  );
}
