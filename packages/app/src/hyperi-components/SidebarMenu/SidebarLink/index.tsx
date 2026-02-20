import { cloneElement } from 'react';
import { Tooltip } from '@mantine/core';
import { Icon } from '@tabler/icons-react';

import styles from './SidebarLink.module.scss';

interface SidebarLinkProps {
  collapsed: boolean;
  item: {
    key: string;
    icon: React.ReactElement<Icon & { className?: string }>;
    label: string;
  };
}

const SidebarLinkContent = ({ collapsed, item }: SidebarLinkProps) => {
  return (
    <a href={item.key} className={styles.hyperiSidebarLink}>
      <span className={styles.hyperiSidebarLinkIconWrapper}>
        {cloneElement(item.icon, { className: styles.hyperiSidebarLinkIcon })}
      </span>

      {!collapsed && <span>{item.label}</span>}
    </a>
  );
};

export const SidebarLink = ({ collapsed, item }: SidebarLinkProps) => {
  if (!collapsed) {
    return <SidebarLinkContent collapsed={collapsed} item={item} />;
  }

  return (
    <Tooltip label={item.label} position="right">
      <SidebarLinkContent collapsed={collapsed} item={item} />
    </Tooltip>
  );
};
