import { ScrollArea } from '@mantine/core';

import { ThemeToggle } from '@/dfe/components/ThemeToggle';
import { UserActionsButton } from '@/dfe/components/UserActionsButton';

import { featureFlagSidebarMenuItems } from './constants';
import { HyperDxNavItems } from './HyperDxNavItems';

import styles from './SidebarMenu.module.scss';

interface SidebarMenuProps {
  isCollapsed: boolean;
}

export const SidebarMenu = ({ isCollapsed }: SidebarMenuProps) => {
  return (
    <>
      <ScrollArea
        type="scroll"
        scrollbarSize={6}
        scrollHideDelay={6}
        classNames={styles}
        className={styles.scrollContainer}
      >
        <div className={styles.scrollContainerContent}>
          <ul className={styles.hyperiSidebarMenu}>
            <li>
              <HyperDxNavItems isCollapsed={isCollapsed} />
            </li>

            {featureFlagSidebarMenuItems.map(item => (
              <li className={styles.hyperiSidebarMenuItem} key={item.key}>
                <item.Component collapsed={isCollapsed} />
              </li>
            ))}
          </ul>
        </div>
      </ScrollArea>
      <div className={styles.hyperiSidebarMenuFooter}>
        {!isCollapsed && (
          <p className={styles.hyperiSidebarMenuFooterText}>v1.0.0</p>
        )}
        <ThemeToggle
          className={styles.hyperiSidebarMenuFooterThemeToggle}
          collapsed={isCollapsed}
        />
        <UserActionsButton collapsed={isCollapsed} />
      </div>
    </>
  );
};
