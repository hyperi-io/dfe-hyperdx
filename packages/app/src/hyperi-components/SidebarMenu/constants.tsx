import {
  IconDatabase as DatabaseOutlined,
  IconFilter as FilterOutlined,
  IconFocus2 as AimOutlined,
  IconSettings as SettingOutlined,
  IconShieldCheck as SafetyCertificateOutlined,
} from '@tabler/icons-react';

import { DFE_UI_BASE_URL } from '@/config';

import { SidebarLink } from './SidebarLink';

interface SidebarMenuProps {
  collapsed: boolean;
  isNewViewEnabled?: boolean;
}

export const featureFlagSidebarMenuItems = [
  {
    key: '/schemas',
    Component: ({ collapsed }: SidebarMenuProps) => (
      <SidebarLink
        collapsed={collapsed}
        item={{
          key: `${DFE_UI_BASE_URL}/schemas`,
          icon: <DatabaseOutlined size={16} />,
          label: 'Schemas',
        }}
      />
    ),
  },
  {
    key: '/rules',
    Component: ({ collapsed }: SidebarMenuProps) => (
      <SidebarLink
        collapsed={collapsed}
        item={{
          key: `${DFE_UI_BASE_URL}/rules`,
          icon: <SafetyCertificateOutlined size={16} />,
          label: 'Rules',
        }}
      />
    ),
  },
  {
    key: '/hunts',
    Component: ({ collapsed }: SidebarMenuProps) => (
      <SidebarLink
        collapsed={collapsed}
        item={{
          key: `${DFE_UI_BASE_URL}/hunts`,
          icon: <AimOutlined size={16} />,
          label: 'Hunts',
        }}
      />
    ),
  },
  {
    key: '/ingest',
    Component: ({ collapsed }: SidebarMenuProps) => (
      <SidebarLink
        collapsed={collapsed}
        item={{
          key: `${DFE_UI_BASE_URL}/ingest`,
          icon: <FilterOutlined size={16} />,
          label: 'Ingest',
        }}
      />
    ),
  },
  {
    key: '/settings',
    Component: ({ collapsed }: SidebarMenuProps) => (
      <SidebarLink
        collapsed={collapsed}
        item={{
          key: `${DFE_UI_BASE_URL}/settings`,
          icon: <SettingOutlined size={16} />,
          label: 'Settings',
        }}
      />
    ),
  },
];
