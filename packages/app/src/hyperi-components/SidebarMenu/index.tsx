import { ScrollArea } from '@mantine/core';

import { featureFlagSidebarMenuItems } from './constants';
import { HyperDxNavItems } from './HyperDxNavItems';

import styles from './SidebarMenu.module.scss';

interface SidebarMenuProps {
  isCollapsed: boolean;
  pathname: string;
}

export const SidebarMenu = ({ isCollapsed, pathname }: SidebarMenuProps) => {
  return (
    <ScrollArea
      type="scroll"
      scrollbarSize={6}
      scrollHideDelay={6}
      classNames={styles}
      className={styles.scrollContainer}
    >
      <ul className={styles.hyperiSidebarMenu}>
        <li>
          <HyperDxNavItems isCollapsed={isCollapsed} pathname={pathname} />
        </li>

        {featureFlagSidebarMenuItems.map(item => (
          <li className={styles.hyperiSidebarMenuItem} key={item.key}>
            <item.Component collapsed={isCollapsed} />
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
};
