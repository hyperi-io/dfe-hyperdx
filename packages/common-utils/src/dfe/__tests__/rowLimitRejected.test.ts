/**
 * A role that constrains `max_rows_to_read` refuses the value HyperDX sends.
 * The client must drop the setting and retry, for the constraint code as well
 * as the read-only one.
 */
import { ClickhouseClient } from '@/clickhouse/node';
import { dfeIsRowLimitRejected } from '@/dfe/rowLimitRejected';

const refusal = (type: string, message: string) =>
  Object.assign(new Error(message), { type });

const ABOVE_MAX = refusal(
  'SETTING_CONSTRAINT_VIOLATION',
  "Setting max_rows_to_read shouldn't be greater than 10000000.",
);
const BELOW_MIN = refusal(
  'SETTING_CONSTRAINT_VIOLATION',
  "Setting max_rows_to_read shouldn't be less than 1.",
);
const READ_ONLY = refusal(
  'READONLY',
  'Cannot modify max_rows_to_read setting in readonly mode.',
);

describe('dfeIsRowLimitRejected', () => {
  it.each([
    ['above the role MAX', ABOVE_MAX, 0, true],
    ['below the role MIN', BELOW_MIN, 0, true],
    ['read-only setting', READ_ONLY, 0, true],
    ['second attempt', ABOVE_MAX, 1, false],
    [
      'another constrained setting',
      refusal(
        'SETTING_CONSTRAINT_VIOLATION',
        "Setting max_memory_usage shouldn't be greater than 1000.",
      ),
      0,
      false,
    ],
    [
      'another error naming the setting',
      refusal('TOO_MANY_ROWS', 'Limit for rows exceeded: max_rows_to_read'),
      0,
      false,
    ],
    ['no message', { type: 'SETTING_CONSTRAINT_VIOLATION' }, 0, false],
    ['no type', { message: 'max_rows_to_read' }, 0, false],
  ])('%s', (_name, error, attempts, expected) => {
    expect(dfeIsRowLimitRejected(error, attempts)).toBe(expected);
  });
});

describe('ClickhouseClient.query against a constrained max_rows_to_read', () => {
  // The server refuses any query that still carries max_rows_to_read. With
  // `barrier`, the first calls wait until that many are in flight, so they all
  // carry the setting before any refusal reaches the client.
  const setup = (refusalError: Error, barrier = 0) => {
    const client = new ClickhouseClient({
      host: 'http://localhost:8123',
      username: 'default',
      password: '',
    });
    let arrived = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const query = jest.fn(async ({ clickhouse_settings }: any) => {
      arrived++;
      if (arrived === barrier) release();
      if (arrived <= barrier) await gate;
      if (clickhouse_settings?.max_rows_to_read !== undefined) {
        throw refusalError;
      }
      return { json: async () => ({ data: [] }) };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stub the transport
    (client as any).client = { query };
    return { client, query };
  };

  const inputs = {
    query: 'SELECT 1',
    format: 'JSON' as const,
    clickhouse_settings: { max_rows_to_read: '0' },
  };

  const sent = (query: jest.Mock, call: number) =>
    query.mock.calls[call][0].clickhouse_settings;

  beforeEach(() => {
    jest.spyOn(console, 'debug').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ['above MAX', ABOVE_MAX],
    ['below MIN', BELOW_MIN],
    ['read-only', READ_ONLY],
  ])('retries once without the setting when refused %s', async (_n, e) => {
    const { client, query } = setup(e);

    await client.query(inputs);

    expect(query).toHaveBeenCalledTimes(2);
    expect(sent(query, 0).max_rows_to_read).toBe('0');
    expect(sent(query, 1)).not.toHaveProperty('max_rows_to_read');
  });

  it('sends later queries without the setting once it was refused', async () => {
    const { client, query } = setup(ABOVE_MAX);

    await client.query(inputs);
    await client.query(inputs);

    expect(query).toHaveBeenCalledTimes(3);
    expect(sent(query, 2)).not.toHaveProperty('max_rows_to_read');
  });

  it('retries every query that was in flight when the first refusal landed', async () => {
    const { client, query } = setup(ABOVE_MAX, 3);

    const results = await Promise.all([
      client.query(inputs),
      client.query(inputs),
      client.query(inputs),
    ]);

    expect(results).toHaveLength(3);
    expect(query).toHaveBeenCalledTimes(6);
  });

  it('surfaces a refusal of another setting', async () => {
    const other = refusal(
      'SETTING_CONSTRAINT_VIOLATION',
      "Setting max_memory_usage shouldn't be greater than 1000.",
    );
    const { client, query } = setup(other);

    await expect(client.query(inputs)).rejects.toThrow('max_memory_usage');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
