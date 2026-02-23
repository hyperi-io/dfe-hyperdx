import {
  IconDatabase as DatabaseOutlined,
  IconFilter as FilterOutlined,
  IconFocus2 as AimOutlined,
  IconSettings as SettingOutlined,
  IconShieldCheck as SafetyCertificateOutlined,
} from '@tabler/icons-react';

import { SidebarLink } from './SidebarLink';

interface SidebarMenuProps {
  collapsed: boolean;
  isNewViewEnabled?: boolean;
}

const dfeUiBaseUrl = process.env.NEXT_PUBLIC_DFE_UI_BASE_URL ?? '';

export const featureFlagSidebarMenuItems = [
  {
    key: '/schemas',
    Component: ({ collapsed }: SidebarMenuProps) => (
      <SidebarLink
        collapsed={collapsed}
        item={{
          key: `${dfeUiBaseUrl}/schemas`,
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
          key: `${dfeUiBaseUrl}/rules`,
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
          key: `${dfeUiBaseUrl}/hunts`,
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
          key: `${dfeUiBaseUrl}/ingest`,
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
          key: `${dfeUiBaseUrl}/settings`,
          icon: <SettingOutlined size={16} />,
          label: 'Settings',
        }}
      />
    ),
  },
];
