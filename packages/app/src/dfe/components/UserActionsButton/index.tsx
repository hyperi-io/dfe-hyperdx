import { ActionIcon, ActionIconProps, Button, Popover } from '@mantine/core';
import { IconLogout, IconUser } from '@tabler/icons-react';

import { useLogout } from './hooks/useLogout';

import styles from './UserActionsButton.module.scss';

interface UserActionsButtonProps extends ActionIconProps {
  collapsed: boolean;
}

export const UserActionsButton = ({
  collapsed,
  ...props
}: UserActionsButtonProps) => {
  const { handleLogout } = useLogout();
  return (
    <Popover
      withArrow
      position={collapsed ? 'right' : 'top'}
      styles={{
        dropdown: {
          border: 0,
          boxShadow: '2px 2px 10px 0 rgba(0, 0, 0, 0.2)',
          borderRadius: '8px',
          padding: '12px',
        },
      }}
    >
      <Popover.Target>
        <ActionIcon className={styles.userActionsButton} {...props}>
          <IconUser size={16} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        <Button
          className={styles.userActionsButtonDropdownButton}
          onClick={handleLogout}
          variant="secondary"
          leftSection={<IconLogout size={16} />}
        >
          Logout
        </Button>
      </Popover.Dropdown>
    </Popover>
  );
};
