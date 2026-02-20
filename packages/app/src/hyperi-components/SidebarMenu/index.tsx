import { featureFlagSidebarMenuItems } from './constants';
import { HyperDxNavItems } from './HyperDxNavItems';

import styles from './SidebarMenu.module.scss';

interface SidebarMenuProps {
  isCollapsed: boolean;
  pathname: string;
}

export const SidebarMenu = ({ isCollapsed, pathname }: SidebarMenuProps) => {
  return (
    <ul className={styles.hyperiSidebarMenu}>
      {/* <li>
        <HyperDxNavItems isCollapsed={isCollapsed} pathname={pathname} />
      </li> */}

      {featureFlagSidebarMenuItems.map(item => (
        <li className={styles.hyperiSidebarMenuItem} key={item.key}>
          <item.Component collapsed={isCollapsed} />
        </li>
      ))}
    </ul>
  );
};
