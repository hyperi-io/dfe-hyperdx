/**
 * DFE: the "exclude this value" action in the row JSON viewer.
 *
 * Upstream offers Add to Filters but no negation, so an analyst can filter TO a
 * value and never filter it AWAY -- the half that matters when triaging noise.
 *
 * Built here as a whole LineAction so `DBRowJsonViewer.tsx` gains one appended
 * `actions.push(...)` next to a brace and keeps upstream's own action body
 * byte-identical. Upstream patches that body (see `bd31ea98`), and a delta that
 * deletes it is a hand-resolve on every sync -- or worse, a rerere replay that
 * silently drops their change.
 */
import { notifications } from '@mantine/notifications';
import { IconFilterX } from '@tabler/icons-react';

import type { LineAction } from '@/components/HyperJson';
import { dfeFilterFieldPath } from '@/dfe/clickhouseJsonPath';

export function dfeExcludeAction({
  keyPath,
  fieldPath,
  value,
  isInParsedJson,
  parsedJsonRootPath,
  jsonColumns,
  mapColumns,
  onPropertyAddClick,
}: {
  keyPath: string[];
  fieldPath: string;
  value: unknown;
  isInParsedJson?: boolean;
  parsedJsonRootPath?: string[];
  jsonColumns?: string[];
  mapColumns?: string[];
  onPropertyAddClick: (
    keyPath: string,
    value: string,
    action?: 'only' | 'exclude' | 'include',
  ) => void;
}): LineAction {
  return {
    key: 'exclude-from-search',
    label: <IconFilterX size={14} />,
    title: 'Exclude this value',
    onClick: () => {
      const filterFieldPath = dfeFilterFieldPath({
        keyPath,
        fieldPath,
        value,
        isInParsedJson,
        parsedJsonRootPath,
        jsonColumns,
        mapColumns,
      });
      // A coerced path compares as text, so the value must be a string too. A
      // boolean passes through unstringified because JSONExtractBool returns
      // 0/1 and would not match the literal 'true'.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- mirrors upstream's own cast in the include action
      const filterValue = (
        filterFieldPath.startsWith('toString(') || typeof value !== 'boolean'
          ? String(value)
          : value
      ) as string;

      onPropertyAddClick(filterFieldPath, filterValue, 'exclude');
      notifications.show({
        color: 'green',
        message: `Excluded "${fieldPath} = ${String(value)}" from filters`,
      });
    },
  };
}
