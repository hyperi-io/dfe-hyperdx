import {
  coerceJsonPathsInSql,
  dfeJsonPathRoot,
  quoteJsonSegment,
  renderJsonNumberExpression,
  renderJsonPath,
  renderJsonStringExpression,
  splitJsonPath,
  unquoteJsonSegment,
} from '@/dfe/jsonPath';

describe('quoting round-trips', () => {
  // The escape/unescape pair must reach a fixed point. Upstream PR #2551
  // shipped an unescape that stripped backticks without undoubling them, and
  // the search page's canonicalise-on-load effect then rewrote a growing
  // filter every render until React threw "Maximum update depth exceeded".
  const segments = [
    'name',
    'user.name',
    'has`backtick',
    'has``doubled',
    'has\\backslash',
    "has'quote",
    'has space',
    '1',
    '',
  ];

  it.each(segments)('unquote(quote(%j)) is the identity', segment => {
    expect(unquoteJsonSegment(quoteJsonSegment(segment))).toBe(segment);
  });

  it.each(segments)(
    'quoting %j is idempotent through a round trip',
    segment => {
      const once = quoteJsonSegment(segment);
      expect(quoteJsonSegment(unquoteJsonSegment(once))).toBe(once);
    },
  );

  it('doubles a backtick when quoting', () => {
    expect(quoteJsonSegment('a`b')).toBe('`a``b`');
  });
});

describe('renderJsonPath', () => {
  it('leaves a bare root unquoted and quotes each segment', () => {
    expect(renderJsonPath('Body', ['user', 'name'])).toBe('Body.`user`.`name`');
  });

  it('quotes a root that is not a bare identifier', () => {
    expect(renderJsonPath('JSON-Attributes', ['k'])).toBe(
      '`JSON-Attributes`.`k`',
    );
  });

  it('keeps a dotted key as ONE segment', () => {
    expect(renderJsonPath('ResourceAttributes', ['k8s.namespace.name'])).toBe(
      'ResourceAttributes.`k8s.namespace.name`',
    );
  });

  it('returns the bare root for an empty path', () => {
    expect(renderJsonPath('Body', [])).toBe('Body');
  });
});

describe('coercion expressions', () => {
  // toString(), never the `.:String` typed sub-column: a JSON path may hold a
  // different concrete type per row, and `.:String` is null for every row not
  // stored as String. Verified against ClickHouse 26.3.17.56.
  it('renders the string form with toString', () => {
    expect(renderJsonStringExpression('Body', ['user', 'name'])).toBe(
      'toString(Body.`user`.`name`)',
    );
  });

  it('renders the numeric form via toString, not a typed sub-column', () => {
    expect(renderJsonNumberExpression('Body', ['latency_ms'])).toBe(
      'toFloat64OrNull(toString(Body.`latency_ms`))',
    );
  });

  it('never emits a typed sub-column suffix', () => {
    expect(renderJsonStringExpression('Body', ['port'])).not.toContain('.:');
    expect(renderJsonNumberExpression('Body', ['port'])).not.toContain('.:');
  });
});

describe('splitJsonPath', () => {
  it('splits a plain dotted path', () => {
    expect(splitJsonPath('Body.user.name')).toEqual(['Body', 'user', 'name']);
  });

  it('treats a backticked segment as one, dots included', () => {
    expect(splitJsonPath('Body.`k8s.namespace.name`')).toEqual([
      'Body',
      '`k8s.namespace.name`',
    ]);
  });

  it('rejects a function call', () => {
    expect(splitJsonPath('toString(Body.user)')).toBeUndefined();
  });

  it('rejects bracket access', () => {
    expect(splitJsonPath("LogAttributes['a.b']")).toBeUndefined();
  });

  it('rejects an unterminated backtick', () => {
    expect(splitJsonPath('Body.`unterminated')).toBeUndefined();
  });

  it('rejects an empty segment', () => {
    expect(splitJsonPath('Body..name')).toBeUndefined();
  });
});

describe('dfeJsonPathRoot', () => {
  const jsonColumns = ['_json', '_tags'];

  it('names the root of a quoted dot path', () => {
    expect(dfeJsonPathRoot('_json.`user`.`name`', jsonColumns)).toBe('_json');
  });

  it('names the root of an unquoted dot path', () => {
    expect(dfeJsonPathRoot('_tags.env', jsonColumns)).toBe('_tags');
  });

  it('rejects a path rooted at a column that is not JSON', () => {
    expect(dfeJsonPathRoot('LogAttributes.host', jsonColumns)).toBeUndefined();
  });

  // arrayElement is illegal on a JSON column, so the caller must not emit it.
  it('rejects bracket form even on a JSON column', () => {
    expect(dfeJsonPathRoot("_json['user.name']", jsonColumns)).toBeUndefined();
  });

  it('rejects the bare column, which has no sub-path', () => {
    expect(dfeJsonPathRoot('_json', jsonColumns)).toBeUndefined();
  });

  it('rejects a function call', () => {
    expect(
      dfeJsonPathRoot('toString(_json.`user`.`name`)', jsonColumns),
    ).toBeUndefined();
  });
});

describe('coerceJsonPathsInSql', () => {
  const jsonColumns = ['Body', 'ResourceAttributes'];

  it('wraps a bare JSON sub-path so IN stops seeing a Dynamic', () => {
    expect(
      coerceJsonPathsInSql("Body.`user`.`name` IN ('alice')", jsonColumns),
    ).toBe("toString(Body.`user`.`name`) IN ('alice')");
  });

  it('coerces an unquoted dot path too', () => {
    expect(coerceJsonPathsInSql('Body.user.name = 1', jsonColumns)).toBe(
      'toString(Body.`user`.`name`) = 1',
    );
  });

  it('leaves a non-JSON column alone', () => {
    const sql = "ServiceName.foo IN ('x')";
    expect(coerceJsonPathsInSql(sql, jsonColumns)).toBe(sql);
  });

  it('leaves Map bracket access alone', () => {
    const sql = "LogAttributes['host.name'] IN ('a')";
    expect(coerceJsonPathsInSql(sql, jsonColumns)).toBe(sql);
  });

  it('leaves a bare JSON column with no sub-path alone', () => {
    const sql = 'notEmpty(Body) = 1';
    expect(coerceJsonPathsInSql(sql, jsonColumns)).toBe(sql);
  });

  it('is idempotent', () => {
    const once = coerceJsonPathsInSql('Body.user.name = 1', jsonColumns);
    expect(coerceJsonPathsInSql(once, jsonColumns)).toBe(once);
  });

  it('does not double-wrap what the Lucene serializer already coerced', () => {
    const sql = "toString(Body.`user`.`name`) ILIKE '%a%'";
    expect(coerceJsonPathsInSql(sql, jsonColumns)).toBe(sql);
  });

  it('leaves dynamicType guards intact', () => {
    const sql = "dynamicType(Body.`port`) in ('Int64')";
    expect(coerceJsonPathsInSql(sql, jsonColumns)).toBe(sql);
  });

  it('coerces several paths in one predicate', () => {
    expect(
      coerceJsonPathsInSql(
        'Body.a = 1 AND ResourceAttributes.b = 2',
        jsonColumns,
      ),
    ).toBe('toString(Body.`a`) = 1 AND toString(ResourceAttributes.`b`) = 2');
  });

  it('is a no-op when the table has no JSON columns', () => {
    const sql = "Body.user.name IN ('alice')";
    expect(coerceJsonPathsInSql(sql, [])).toBe(sql);
  });

  it('handles an empty condition', () => {
    expect(coerceJsonPathsInSql('', jsonColumns)).toBe('');
  });

  // The facet path renders `.:String` before this seam sees it. Quoting that as
  // a path segment looks up a JSON key literally named `:String`, which is
  // empty for every row -- the sidebar then drops the facet as valueless.
  describe('typed sub-column suffix', () => {
    it('replaces the typed suffix with a toString coercion', () => {
      expect(
        coerceJsonPathsInSql('Body.`user`.`name`.:String', jsonColumns),
      ).toBe('toString(Body.`user`.`name`)');
    });

    it('never quotes the suffix as a path segment', () => {
      expect(
        coerceJsonPathsInSql('Body.`user`.`name`.:String', jsonColumns),
      ).not.toContain('`:String`');
    });

    it('handles a typed suffix in a select list', () => {
      expect(
        coerceJsonPathsInSql(
          'ServiceName as param0, Body.`user`.`name`.:String as param1',
          jsonColumns,
        ),
      ).toBe('ServiceName as param0, toString(Body.`user`.`name`) as param1');
    });

    it('leaves a bare column with only a typed suffix alone', () => {
      const sql = 'Body.:String';
      expect(coerceJsonPathsInSql(sql, jsonColumns)).toBe(sql);
    });

    // The facet batch wraps each key in groupUniqArray(N)(...). Dropping one of
    // those closing parens is a syntax error that fails the WHOLE batch, so
    // every other column's values disappear with it.
    it('keeps the enclosing aggregate balanced', () => {
      const out = coerceJsonPathsInSql(
        'SELECT groupUniqArray(10000)(ServiceName) AS param0, ' +
          'groupUniqArray(10000)(ResourceAttributes.`key`.`subKey`.:String) AS param1 FROM t',
        ['ResourceAttributes'],
      );

      expect(out).toContain(
        'groupUniqArray(10000)(toString(ResourceAttributes.`key`.`subKey`)) AS param1',
      );
      expect((out.match(/\(/g) ?? []).length).toBe(
        (out.match(/\)/g) ?? []).length,
      );
    });
  });

  // Aggregate arguments need no pass of ours: aggFnExpr in renderChartConfig
  // already emits toFloat64OrDefault(toString(expr)) around them. Pinned so a
  // second coercion is not reintroduced if that wrapper is ever read as absent.
  it('leaves an aggregate argument upstream already coerced', () => {
    const sql = 'avg(toFloat64OrDefault(toString(Body.latency_ms)))';
    expect(coerceJsonPathsInSql(sql, jsonColumns)).toBe(sql);
  });
});
