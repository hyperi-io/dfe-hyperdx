# Frontend

> **Scope.** This describes UPSTREAM HyperDX's architecture, which we do not
> modify. It is here so the fork's own docs are readable on their own;
> upstream's [`agent_docs/`](../../agent_docs/) is the authority, and anything
> specific to DFE is called out as such.

```mermaid
flowchart TB
    subgraph Next_js_Pages_Router["Next.js (Pages Router)"]
        SEARCH["Search Page<br/>Log/Trace search"]
        DASH["Dashboard Page<br/>Chart tiles"]
        ALERTS["Alerts Page<br/>Alert management"]
        SESSIONS["Sessions Page<br/>Session replay"]
        SERVICES["Services Page<br/>APM overview"]
        SVCMAP["Service Map<br/>Trace topology"]
        CHART["Chart Explorer<br/>Ad-hoc charting"]
        CHSQL["SQL Page<br/>Direct ClickHouse SQL"]
    end

    subgraph Core_Components["Core Components"]
        NAV["AppNav<br/>Sidebar navigation"]
        TIMECHART["DBTimeChart<br/>Time-series visualization"]
        TABLE["DBTableChart<br/>Tabular data"]
        SIDEPANEL["DBRowSidePanel<br/>Log/trace detail"]
        WATERFALL["DBTraceWaterfallChart<br/>Span waterfall"]
        PLAYER["DOMPlayer<br/>rrweb session replay"]
        SQLEDITOR["SQLEditor<br/>CodeMirror SQL input"]
        SEARCHINPUT["SearchInputV2<br/>Lucene/SQL autocomplete"]
    end

    subgraph State_Data["State & Data"]
        URL["URL Params<br/>(nuqs)"]
        TQ["TanStack Query<br/>(server state)"]
        CHC["ClickhouseClient<br/>(browser)"]
        API_HOOKS["API Hooks<br/>(ky + /api/*)"]
    end

    SEARCH & DASH & ALERTS & SESSIONS --> NAV
    SEARCH --> SEARCHINPUT & TABLE & SIDEPANEL
    DASH --> TIMECHART & TABLE
    SESSIONS --> PLAYER
    SERVICES --> TIMECHART
    SVCMAP --> WATERFALL

    TIMECHART & TABLE --> CHC
    CHC -->|common-utils<br/>renderChartConfig| CHC
    CHC -->|/api/clickhouse-proxy| API_HOOKS
    ALERTS --> API_HOOKS
    API_HOOKS --> TQ
    SEARCH & DASH --> URL
```

Key patterns:

- **URL-driven state**: All search filters, time ranges, and dashboard contexts
  are encoded in URL parameters (via `nuqs`), making every view deep-linkable
- **Server state**: TanStack Query manages all API data with custom hooks in
  `api.ts`, `dashboard.ts`, `savedSearch.ts`, `source.ts`, `sessions.ts`
- **Query engine in browser**: `renderChartConfig()` from `common-utils` runs
  client-side, generating parameterized SQL sent through the ClickHouse proxy
- **UI library**: Mantine components throughout, with Recharts and uPlot for
  charts, CodeMirror for SQL editing, and rrweb for session replay
