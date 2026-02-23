import cx from 'classnames';
import { ActionIcon, ActionIconProps, Tooltip } from '@mantine/core';
import { IconMoon, IconSun } from '@tabler/icons-react';

import { useUserPreferences } from '@/useUserPreferences';

import styles from './ThemeToggle.module.scss';

interface ThemeToggleProps extends ActionIconProps {
  collapsed: boolean;
}

export const ThemeToggle = ({
  collapsed,
  className,
  ...props
}: ThemeToggleProps) => {
  const { userPreferences, setUserPreference } = useUserPreferences();
  const colorMode = userPreferences.colorMode;

  const handleSetColorScheme = () => {
    setUserPreference({
      colorMode: colorMode === 'dark' ? 'light' : 'dark',
    });
  };
  return (
    <Tooltip
      color="dark.5"
      label={`Switch to ${colorMode === 'dark' ? 'light' : 'dark'} mode`}
      position={collapsed ? 'right' : 'top'}
      withArrow
    >
      <ActionIcon
        onClick={handleSetColorScheme}
        className={cx(styles.themeToggle, className)}
        {...props}
      >
        {colorMode === 'dark' ? (
          <IconSun className={styles.themeToggleIconSun} size={16} />
        ) : (
          <IconMoon size={16} />
        )}
      </ActionIcon>
    </Tooltip>
  );
};
