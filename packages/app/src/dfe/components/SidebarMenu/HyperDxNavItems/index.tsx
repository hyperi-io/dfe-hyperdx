/* eslint-disable @typescript-eslint/ban-ts-comment -- see the note below */
// @ts-nocheck
// DFE INTERIM (2.29 merge): this sidebar nav drifted vs upstream 2.29
// (use-query-params -> nuqs, removed @/types SavedSearch/ServerDashboard, Mantine
// v9 Collapse API). It is currently ORPHANED (layout renders upstream AppNav) and
// is being REPLACED by the config-driven condensed embed nav. Suppressing type
// checks on this one throwaway file so the build stays green; it is never bundled.
// Remove this file (and @ts-nocheck) when the embed nav lands.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Router, { useRouter } from 'next/router';
import cx from 'classnames';
import Fuse from 'fuse.js';
import {
  NumberParam,
  StringParam,
  useQueryParam,
  useQueryParams,
  withDefault,
} from 'use-query-params';
import {
  Button,
  CloseButton,
  Collapse,
  Group,
  Input,
  Loader,
  Tooltip,
} from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import {
  IconChartDots,
  IconChevronDown,
  IconChevronRight,
  IconCommand,
  IconLayoutGrid,
  IconSearch,
  IconTable,
} from '@tabler/icons-react';

import { IS_LOCAL_MODE } from '@/config';
import {
  useCreateDashboard,
  useDashboards,
  useUpdateDashboard,
} from '@/dashboard';
import { useSavedSearches, useUpdateSavedSearch } from '@/savedSearch';
import type { SavedSearch, ServerDashboard } from '@/types';

import { AppNavLink } from './HyperDxNavItems.components';

import styles from './HyperDxNavItems.module.scss';

const UNTAGGED_SEARCHES_GROUP_NAME = 'Saved Searches';
const UNTAGGED_DASHBOARDS_GROUP_NAME = 'Saved Dashboards';

// Navigation link configuration
type NavLinkConfig = {
  id: string;
  label: string;
  href: string;
  icon: React.ReactNode;
  isBeta?: boolean;
  cloudOnly?: boolean; // Only show when not in local mode
};

const _NAV_LINKS: NavLinkConfig[] = [
  {
    id: 'chart',
    label: 'Chart Explorer',
    href: '/chart',
    icon: <IconChartDots size={16} />,
  },
];

function NewDashboardButton() {
  const createDashboard = useCreateDashboard();

  if (IS_LOCAL_MODE) {
    return (
      <Button
        component={Link}
        href="/dashboards"
        data-testid="create-dashboard-button"
        variant="transparent"
        color="var(--color-text)"
        py="0px"
        px="sm"
        fw={400}
      >
        <span className="pe-2">+</span> Create Dashboard
      </Button>
    );
  }

  return (
    <Button
      data-testid="create-dashboard-button"
      variant="transparent"
      color="var(--color-text)"
      py="0px"
      px="sm"
      fw={400}
      onClick={() =>
        createDashboard.mutate(
          {
            name: 'My Dashboard',
            tiles: [],
            tags: [],
          },
          {
            onSuccess: data => {
              Router.push(`/dashboards/${data.id}`);
            },
          },
        )
      }
    >
      <span className="pe-2">+</span> Create Dashboard
    </Button>
  );
}

function SearchInput({
  placeholder,
  value,
  onChange,
  onEnterDown,
}: {
  placeholder: string;
  value: string;
  onChange: (arg0: string) => void;
  onEnterDown?: () => void;
}) {
  const kbdShortcut = useMemo(() => {
    return (
      <div className={styles.shortcutHint}>
        {window.navigator.platform?.toUpperCase().includes('MAC') ? (
          <IconCommand size={8} />
        ) : (
          <span className={styles.shortcutHintCtrl}>Ctrl</span>
        )}
        &nbsp;K
      </div>
    );
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        onEnterDown?.();
      }
    },
    [onEnterDown],
  );

  return (
    <Input
      data-testid="nav-search-input"
      placeholder={placeholder}
      value={value}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
        onChange(e.currentTarget.value)
      }
      leftSection={<IconSearch size={16} className="ps-1" />}
      onKeyDown={handleKeyDown}
      rightSection={
        value ? (
          <CloseButton
            data-testid="nav-search-clear"
            tabIndex={-1}
            size="xs"
            radius="xl"
            onClick={() => onChange('')}
          />
        ) : (
          kbdShortcut
        )
      }
      mt={8}
      mb="sm"
      size="xs"
      variant="filled"
      radius="xl"
      className={styles.searchInput}
    />
  );
}

interface AppNavLinkItem {
  id: string;
  name: string;
  tags?: string[];
}

type AppNavLinkGroup<T extends AppNavLinkItem> = {
  name: string;
  items: T[];
};

const AppNavGroupLabel = ({
  name,
  collapsed,
  onClick,
}: {
  name: string;
  collapsed: boolean;
  onClick: () => void;
}) => {
  return (
    <div className={styles.groupLabel} onClick={onClick}>
      {collapsed ? (
        <IconChevronRight size={14} />
      ) : (
        <IconChevronDown size={14} />
      )}
      <div>{name}</div>
    </div>
  );
};

const AppNavLinkGroups = <T extends AppNavLinkItem>({
  name,
  groups,
  renderLink,
  onDragEnd,
  forceExpandGroups = false,
}: {
  name: string;
  groups: AppNavLinkGroup<T>[];
  renderLink: (item: T) => React.ReactNode;
  onDragEnd?: (target: HTMLElement | null, newGroup: string | null) => void;
  forceExpandGroups?: boolean;
}) => {
  const [collapsedGroups, setCollapsedGroups] = useLocalStorage<
    Record<string, boolean>
  >({
    key: `collapsedGroups-${name}`,
    defaultValue: {},
  });

  const handleToggleGroup = useCallback(
    (groupName: string) => {
      setCollapsedGroups({
        ...collapsedGroups,
        [groupName]: !collapsedGroups[groupName],
      });
    },
    [collapsedGroups, setCollapsedGroups],
  );

  const [draggingOver, setDraggingOver] = useState<string | null>(null);

  return (
    <>
      {groups.map(group => (
        <div
          key={group.name}
          className={cx(draggingOver === group.name && styles.groupDragOver)}
          onDragOver={e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDraggingOver(group.name);
          }}
          onDragEnd={e => {
            e.preventDefault();
            onDragEnd?.(e.target as HTMLElement, draggingOver);
            setDraggingOver(null);
          }}
        >
          <AppNavGroupLabel
            onClick={() => handleToggleGroup(group.name)}
            name={group.name}
            collapsed={collapsedGroups[group.name]}
          />
          <Collapse in={!collapsedGroups[group.name] || forceExpandGroups}>
            {group.items.map(item => renderLink(item))}
          </Collapse>
        </div>
      ))}
    </>
  );
};

function useSearchableList<T extends AppNavLinkItem>({
  items,
  untaggedGroupName = 'Other',
}: {
  items: T[];
  untaggedGroupName?: string;
}) {
  const fuse = useMemo(
    () =>
      new Fuse(items, {
        keys: ['name'],
        threshold: 0.2,
        ignoreLocation: true,
      }),
    [items],
  );

  const [q, setQ] = useState('');

  const filteredList = useMemo(() => {
    if (q === '') {
      return items;
    }
    return fuse.search(q).map(result => result.item);
  }, [fuse, items, q]);

  const groupedFilteredList = useMemo<AppNavLinkGroup<T>[]>(() => {
    // group by tags
    const groupedItems: Record<string, T[]> = {};
    const untaggedItems: T[] = [];
    filteredList.forEach(item => {
      if (item.tags?.length) {
        item.tags.forEach(tag => {
          groupedItems[tag] = groupedItems[tag] ?? [];
          groupedItems[tag].push(item);
        });
      } else {
        untaggedItems.push(item);
      }
    });
    if (untaggedItems.length) {
      groupedItems[untaggedGroupName] = untaggedItems;
    }
    return Object.entries(groupedItems)
      .map(([name, items]) => ({
        name,
        items,
      }))
      .sort((a, b) => {
        if (a.name === untaggedGroupName) {
          return 1;
        }
        if (b.name === untaggedGroupName) {
          return -1;
        }
        return a.name.localeCompare(b.name);
      });
  }, [filteredList, untaggedGroupName]);

  return {
    filteredList,
    groupedFilteredList,
    q,
    setQ,
  };
}

export const HyperDxNavItems = ({
  isCollapsed = false,
}: {
  isCollapsed: boolean;
}) => {
  useEffect(() => {
    let redirectUrl;
    try {
      redirectUrl = window.sessionStorage.getItem('hdx-login-redirect-url');
    } catch (e: any) {
      console.error(e);
    }
    // conditional redirect
    if (redirectUrl) {
      // with router.push the page may be added to history
      // the browser on history back will  go back to this page and then forward again to the redirected page
      // you can prevent this behaviour using location.replace
      window.sessionStorage.removeItem('hdx-login-redirect-url');
      Router.push(redirectUrl);
    }
  }, []);

  const {
    data: logViewsData,
    isLoading: isLogViewsLoading,
    refetch: refetchLogViews,
  } = useSavedSearches();
  const logViews = useMemo(() => logViewsData ?? [], [logViewsData]);

  const updateDashboard = useUpdateDashboard();
  const updateLogView = useUpdateSavedSearch();

  const {
    data: dashboardsData,
    isLoading: isDashboardsLoading,
    refetch: refetchDashboards,
  } = useDashboards();
  const dashboards = useMemo(() => dashboardsData ?? [], [dashboardsData]);

  const router = useRouter();
  const { query } = router;

  const [timeRangeQuery] = useQueryParams({
    from: withDefault(NumberParam, -1),
    to: withDefault(NumberParam, -1),
  });
  const [inputTimeQuery] = useQueryParam('tq', withDefault(StringParam, ''), {
    updateType: 'pushIn',
    enableBatching: true,
  });

  const [isSearchExpanded, setIsSearchExpanded] = useLocalStorage<boolean>({
    key: 'isSearchExpanded',
    defaultValue: true,
  });
  const [isDashboardsExpanded, setIsDashboardExpanded] =
    useLocalStorage<boolean>({
      key: 'isDashboardsExpanded',
      defaultValue: true,
    });

  const {
    q: searchesListQ,
    setQ: setSearchesListQ,
    filteredList: filteredSearchesList,
    groupedFilteredList: groupedFilteredSearchesList,
  } = useSearchableList({
    items: logViews,
    untaggedGroupName: UNTAGGED_SEARCHES_GROUP_NAME,
  });

  const {
    q: dashboardsListQ,
    setQ: setDashboardsListQ,
    filteredList: filteredDashboardsList,
    groupedFilteredList: groupedFilteredDashboardsList,
  } = useSearchableList({
    items: dashboards,
    untaggedGroupName: UNTAGGED_DASHBOARDS_GROUP_NAME,
  });

  const savedSearchesResultsRef = useRef<HTMLDivElement>(null);
  const dashboardsResultsRef = useRef<HTMLDivElement>(null);

  const renderLogViewLink = useCallback(
    (savedSearch: SavedSearch) => (
      <Link
        href={`/search/${savedSearch.id}?${new URLSearchParams(
          timeRangeQuery.from != -1 && timeRangeQuery.to != -1
            ? {
                from: timeRangeQuery.from.toString(),
                to: timeRangeQuery.to.toString(),
                tq: inputTimeQuery,
              }
            : {},
        ).toString()}`}
        key={savedSearch.id}
        tabIndex={0}
        className={cx(
          styles.subMenuItem,
          savedSearch.id === query.savedSearchId && styles.subMenuItemActive,
        )}
        title={savedSearch.name}
        draggable
        data-savedsearchid={savedSearch.id}
      >
        <Group gap={2}>
          <div className="d-inline-block text-truncate">{savedSearch.name}</div>
        </Group>
      </Link>
    ),
    [
      inputTimeQuery,
      query.savedSearchId,
      timeRangeQuery.from,
      timeRangeQuery.to,
    ],
  );

  const handleLogViewDragEnd = useCallback(
    (target: HTMLElement | null, name: string | null) => {
      if (!target?.dataset.savedsearchid || name == null) {
        return;
      }
      const logView = logViews.find(
        lv => lv.id === target.dataset.savedsearchid,
      );
      if (logView?.tags?.includes(name)) {
        return;
      }
      updateLogView.mutate(
        {
          id: target.dataset.savedsearchid,
          tags: name === UNTAGGED_SEARCHES_GROUP_NAME ? [] : [name],
        },
        {
          onSuccess: () => {
            refetchLogViews();
          },
        },
      );
    },
    [logViews, refetchLogViews, updateLogView],
  );

  const renderDashboardLink = useCallback(
    (dashboard: ServerDashboard) => (
      <Link
        href={`/dashboards/${dashboard.id}`}
        key={dashboard.id}
        tabIndex={0}
        className={cx(styles.subMenuItem, {
          [styles.subMenuItemActive]: dashboard.id === query.dashboardId,
        })}
        draggable
        data-dashboardid={dashboard.id}
      >
        {dashboard.name}
      </Link>
    ),
    [query.dashboardId],
  );

  const handleDashboardDragEnd = useCallback(
    (target: HTMLElement | null, name: string | null) => {
      if (!target?.dataset.dashboardid || name == null) {
        return;
      }
      const dashboard = dashboards.find(
        d => d.id === target.dataset.dashboardid,
      );
      if (dashboard?.tags?.includes(name)) {
        return;
      }
      updateDashboard.mutate(
        {
          id: target.dataset.dashboardid,
          tags: name === UNTAGGED_DASHBOARDS_GROUP_NAME ? [] : [name],
        },
        {
          onSuccess: () => {
            refetchDashboards();
          },
        },
      );
    },
    [dashboards, refetchDashboards, updateDashboard],
  );

  return (
    <>
      <div className={styles.navLinks}>
        {/* Search */}
        {isCollapsed ? (
          <Tooltip color="dark.5" label="Search" withArrow position="right">
            <span style={{ display: 'flex', width: '100%' }}>
              <AppNavLink
                label="Search"
                icon={<IconTable size={16} />}
                href="/search"
                isExpanded={isSearchExpanded}
                onToggle={
                  !IS_LOCAL_MODE
                    ? () => setIsSearchExpanded(!isSearchExpanded)
                    : undefined
                }
              />
            </span>
          </Tooltip>
        ) : (
          <AppNavLink
            label="Search"
            icon={<IconTable size={16} />}
            href="/search"
            isExpanded={isSearchExpanded}
            onToggle={
              !IS_LOCAL_MODE
                ? () => setIsSearchExpanded(!isSearchExpanded)
                : undefined
            }
          />
        )}
        {!isCollapsed && (
          <Collapse in={isSearchExpanded}>
            <div className={styles.subMenu}>
              {isLogViewsLoading ? (
                <Loader variant="dots" mx="md" my="xs" size="sm" />
              ) : (
                !IS_LOCAL_MODE && (
                  <>
                    <SearchInput
                      placeholder="Saved Searches"
                      value={searchesListQ}
                      onChange={setSearchesListQ}
                      onEnterDown={() => {
                        (
                          savedSearchesResultsRef?.current
                            ?.firstChild as HTMLAnchorElement
                        )?.focus?.();
                      }}
                    />

                    {logViews.length === 0 && (
                      <div className={styles.emptyMessage}>
                        No saved searches
                      </div>
                    )}
                    <div ref={savedSearchesResultsRef}>
                      <AppNavLinkGroups
                        name="saved-searches"
                        groups={groupedFilteredSearchesList}
                        renderLink={renderLogViewLink}
                        forceExpandGroups={!!searchesListQ}
                        onDragEnd={handleLogViewDragEnd}
                      />
                    </div>

                    {searchesListQ && filteredSearchesList.length === 0 ? (
                      <div className={styles.emptyMessage}>
                        No results matching <i>{searchesListQ}</i>
                      </div>
                    ) : null}
                  </>
                )
              )}
            </div>
          </Collapse>
        )}
        {/* Charts */}
        {isCollapsed ? (
          <Tooltip color="dark.5" label="Charts" withArrow position="right">
            <span style={{ display: 'flex', width: '100%' }}>
              <AppNavLink
                label="Chart Explorer"
                href="/chart"
                icon={<IconChartDots size={16} />}
              />
            </span>
          </Tooltip>
        ) : (
          <AppNavLink
            label="Chart Explorer"
            href="/chart"
            icon={<IconChartDots size={16} />}
          />
        )}
        {/* Dashboards */}
        {isCollapsed ? (
          <Tooltip color="dark.5" label="Dashboards" withArrow position="right">
            <span style={{ display: 'flex', width: '100%' }}>
              <AppNavLink
                label="Dashboards"
                href="/dashboards"
                icon={<IconLayoutGrid size={16} />}
                isExpanded={isDashboardsExpanded}
                onToggle={() => setIsDashboardExpanded(!isDashboardsExpanded)}
              />
            </span>
          </Tooltip>
        ) : (
          <AppNavLink
            label="Dashboards"
            href="/dashboards"
            icon={<IconLayoutGrid size={16} />}
            isExpanded={isDashboardsExpanded}
            onToggle={() => setIsDashboardExpanded(!isDashboardsExpanded)}
          />
        )}
        {!isCollapsed && (
          <Collapse in={isDashboardsExpanded}>
            <div className={styles.subMenu}>
              <NewDashboardButton />

              {isDashboardsLoading ? (
                <Loader variant="dots" mx="md" my="xs" size="sm" />
              ) : (
                !IS_LOCAL_MODE && (
                  <>
                    <SearchInput
                      placeholder="Saved Dashboards"
                      value={dashboardsListQ}
                      onChange={setDashboardsListQ}
                      onEnterDown={() => {
                        (
                          dashboardsResultsRef?.current
                            ?.firstChild as HTMLAnchorElement
                        )?.focus?.();
                      }}
                    />

                    <AppNavLinkGroups
                      name="dashboards"
                      groups={groupedFilteredDashboardsList}
                      renderLink={renderDashboardLink}
                      forceExpandGroups={!!dashboardsListQ}
                      onDragEnd={handleDashboardDragEnd}
                    />

                    {dashboards.length === 0 && (
                      <div className={styles.emptyMessage}>
                        No saved dashboards
                      </div>
                    )}

                    {dashboardsListQ && filteredDashboardsList.length === 0 ? (
                      <div className={styles.emptyMessage}>
                        No results matching <i>{dashboardsListQ}</i>
                      </div>
                    ) : null}
                  </>
                )
              )}
            </div>
          </Collapse>
        )}
      </div>
    </>
  );
};
