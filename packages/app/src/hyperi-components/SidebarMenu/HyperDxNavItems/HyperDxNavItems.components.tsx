import React from 'react';
import Link from 'next/link';
import cx from 'classnames';
import { Badge } from '@mantine/core';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';

import { AppNavContext } from '@/hyperi-components/AppNav';

import styles from './HyperDxNavItems.module.scss';

export const AppNavLink = ({
  className,
  label,
  icon,
  href,
  isExpanded,
  onToggle,
  isBeta,
}: {
  className?: string;
  label: React.ReactNode;
  icon: React.ReactNode;
  href: string;
  isExpanded?: boolean;
  onToggle?: () => void;
  isBeta?: boolean;
}) => {
  const { pathname, isCollapsed } = React.useContext(AppNavContext);

  const testId = `nav-link-${href.replace(/^\//, '').replace(/\//g, '-') || 'home'}`;

  const handleToggleClick = (e: React.MouseEvent) => {
    // Clicking chevron only toggles submenu, doesn't navigate
    // This separates navigation (clicking link) from expand/collapse (clicking chevron)
    e.preventDefault();
    e.stopPropagation();
    onToggle?.();
  };

  // Check if current path matches this nav item
  // Use exact match or startsWith to avoid partial matches (e.g., /search matching /search-settings)
  const isActive = pathname === href || pathname?.startsWith(href + '/');

  return (
    <Link
      data-testid={testId}
      href={href}
      className={cx(
        styles.navItem,
        { [styles.navItemActive]: isActive },
        className,
      )}
    >
      <span className={styles.navItemContent}>
        <span className={styles.navItemIcon}>{icon}</span>
        {!isCollapsed && <span>{label}</span>}
      </span>
      {!isCollapsed && isBeta && (
        <Badge
          size="xs"
          color="blue"
          variant="light"
          className={styles.navItemBadge}
        >
          Beta
        </Badge>
      )}
      {!isCollapsed && onToggle && (
        <button
          type="button"
          data-testid={`${testId}-toggle`}
          className={styles.navItemToggle}
          onClick={handleToggleClick}
        >
          {isExpanded ? (
            <IconChevronUp size={14} className="text-muted-hover" />
          ) : (
            <IconChevronDown size={14} className="text-muted-hover" />
          )}
        </button>
      )}
    </Link>
  );
};
