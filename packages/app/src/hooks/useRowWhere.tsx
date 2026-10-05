import { useCallback, useMemo } from 'react';
import MD5 from 'crypto-js/md5';
import SqlString from 'sqlstring';
import z from 'zod';
import {
  ColumnMetaType,
  convertCHDataTypeToJSType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { quoteResultColumnNameIfNeeded } from '@hyperdx/common-utils/dist/core/metadata';
import { aliasMapToWithClauses } from '@hyperdx/common-utils/dist/core/utils';
import { WithClauseSchema } from '@hyperdx/common-utils/dist/types';

const MAX_STRING_LENGTH = 512;

// Type for WITH clause entries, derived from ChartConfig's with property
export type WithClause = z.infer<typeof WithClauseSchema>;

// Internal row field names used by the table component for row tracking
export const INTERNAL_ROW_FIELDS = {
  ID: '__hyperdx_id',
  ALIAS_WITH: '__hyperdx_alias_with',
} as const;

export const getRowId = (row: Record<string, any>): string =>
  row[INTERNAL_ROW_FIELDS.ID];

// Result type for row WHERE clause with alias support
export type RowWhereResult = {
  where: string;
  aliasWith: WithClause[];
};

type ColumnWithMeta = ColumnMetaType & {
  valueExpr: string;
  jsType: JSDataType | null;
};

export function processRowToWhereClause(
  row: Record<string, any>,
  columnMap: Map<string, ColumnWithMeta>,
): string {
  const res = Object.entries(row)
    .map(([column, value]) => {
      const cm = columnMap.get(column);
      const chType = cm?.type;
      const jsType = cm?.jsType;
      const valueExpr = cm?.valueExpr;

      if (chType == null) {
        throw new Error(
          `Column type not found for ${column}, ${JSON.stringify(columnMap)}`,
        );
      }

      if (valueExpr == null) {
        throw new Error(
          `valueExpr not found for ${column}, ${JSON.stringify(columnMap)}`,
        );
      }

      // Handle nullish values for all types uniformly
      if (value == null) {
        return SqlString.format(`isNull(?)`, [SqlString.raw(valueExpr)]);
      }

      switch (jsType) {
        case JSDataType.Date:
          return SqlString.format(`?=parseDateTime64BestEffort(?, 9)`, [
            SqlString.raw(valueExpr),
            value,
          ]);
        case JSDataType.Array:
        case JSDataType.Map:
          return SqlString.format(`?=JSONExtract(?, ?)`, [
            SqlString.raw(valueExpr),
            value,
            chType,
          ]);
        case JSDataType.Tuple:
          return SqlString.format(`toJSONString(?)=?`, [
            SqlString.raw(valueExpr),
            value,
          ]);
        case JSDataType.JSON: {
          // CH may return JSON as a parsed object; match processedRows stringification.
          const normalized =
            typeof value === 'string'
              ? value
              : (JSON.stringify(value) ?? 'null').replace(/\//g, '\\/');
          return SqlString.format(`lower(hex(MD5(toString(?))))=?`, [
            SqlString.raw(valueExpr),
            MD5(normalized).toString(),
          ]);
        }
        case JSDataType.Dynamic: {
          let dynamicValue: unknown = value;
          if (dynamicValue != null && typeof dynamicValue === 'object') {
            dynamicValue = JSON.stringify(dynamicValue);
          }

          // Currently we can't distinguish null or 'null'
          if (dynamicValue == null || dynamicValue === 'null') {
            return SqlString.format(`isNull(?)`, [SqlString.raw(valueExpr)]);
          }
          const dynamicStr =
            typeof dynamicValue === 'string'
              ? dynamicValue
              : String(dynamicValue);
          if (dynamicStr.length > 1000 || column.length > 1000) {
            console.warn('Search value/object key too large.');
          }
          // TODO: update when JSON type have new version

          // escaped strings needs raw, because sqlString will add another layer of escaping
          // data other than array/object will always return with double quote(because of CH)
          // remove double quote to search correctly.
          // The coalesce is to handle the case when JSONExtract returns null due to the value being a string.
          return SqlString.format(
            "toJSONString(?) = coalesce(toJSONString(JSONExtract(?, 'Dynamic')), toJSONString(?))",
            [SqlString.raw(valueExpr), dynamicStr, dynamicStr],
          );
        }

        default: {
          // Nullish values are handled uniformly before the switch.
          // Objects (e.g. parsed JSON sub-values) get stringified so the
          // downstream length check and equality comparison operate on text.
          let val: string | number | boolean | bigint | null = value;
          if (typeof value === 'object') {
            val = JSON.stringify(value);
          }
          // Handle the case when string is too long
          if (typeof val === 'string' && val.length > MAX_STRING_LENGTH) {
            return SqlString.format(
              // We need to slice since md5 can be slow on big payloads
              // which will block the main thread on search table render
              // UTF8 since js only slices in utf8 points, not bytes
              `lower(hex(MD5(leftUTF8(?, 1000))))=?`,
              [
                SqlString.raw(valueExpr),
                MD5(val.substring(0, 1000)).toString(),
              ],
            );
          }
          return SqlString.format(`?=?`, [
            SqlString.raw(valueExpr), // don't escape expressions
            val,
          ]);
        }
      }
    })
    .join(' AND ');

  return res;
}

export default function useRowWhere({
  meta,
  aliasMap,
  primaryKeyColumns,
}: {
  meta?: ColumnMetaType[];
  aliasMap?: Record<string, string | undefined>; // map alias -> valueExpr, undefined is not supported
  primaryKeyColumns?: Set<string>;
}) {
  const columnMap = useMemo(
    () =>
      new Map(
        meta?.map(c => {
          // if aliasMap is provided, use the alias as the valueExpr
          // but if the alias is not found, fall back to the column name.
          // Alias entries are already SQL expressions; a result column name
          // needs quoting when it isn't one (e.g. `x-host-header`).
          const valueExpr =
            aliasMap?.[c.name] ?? quoteResultColumnNameIfNeeded(c.name);

          return [
            c.name,
            {
              ...c,
              valueExpr: valueExpr,
              jsType: convertCHDataTypeToJSType(c.type),
            },
          ];
        }),
      ),
    [meta, aliasMap],
  );

  // Memoize the aliasWith array since it only depends on aliasMap
  const aliasWith = useMemo(
    () => aliasMapToWithClauses(aliasMap) ?? [],
    [aliasMap],
  );

  return useCallback(
    (row: Record<string, any>): RowWhereResult => {
      // Filter out synthetic columns that aren't in the database schema
      const {
        [INTERNAL_ROW_FIELDS.ID]: _id,
        [INTERNAL_ROW_FIELDS.ALIAS_WITH]: _aliasWith,
        ...dbRow
      } = row;

      // When primaryKeyColumns is provided, only use those columns in the
      // WHERE clause. This avoids filtering on large columns like Body that
      // trigger expensive index loading in ClickHouse.
      const filteredRow = primaryKeyColumns
        ? Object.fromEntries(
            Object.entries(dbRow).filter(([col]) => primaryKeyColumns.has(col)),
          )
        : dbRow;

      return {
        where: processRowToWhereClause(filteredRow, columnMap),
        aliasWith,
      };
    },
    [columnMap, aliasWith, primaryKeyColumns],
  );
}
