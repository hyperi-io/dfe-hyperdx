# HyperDX alerting disabled in favour of DFE rules and hunts

HyperDX includes a built-in alerting system (the `checkAlerts` background task,
Alert/AlertHistory models, webhook notifications). **We disable this entirely**
and use the DFE platform's own rules engine and hunt workflows instead.

### What Gets Disabled

| HyperDX Component                                    | Status                                                       | Reason                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------- |
| `checkAlerts` background task                        | **Disabled** - do not start this process                     | DFE rules engine replaces it                            |
| Alert model + AlertHistory model                     | **Unused** - data stays in FerretDB but is never written to  | No cleanup needed                                       |
| `/alerts` API routes                                 | **Blocked by Casbin** - deny `alerts` resource for all roles | Or leave accessible read-only for viewing legacy alerts |
| `/webhooks` API routes                               | **Blocked by Casbin** - deny `webhooks` resource             | DFE handles notifications                               |
| Alert UI in frontend                                 | **Left in place** - just inaccessible via RBAC               | No frontend code changes                                |
| Silence alert endpoint (`/ext/silence-alert/:token`) | **Dead** - no alerts fire, so no tokens are generated        | No change needed                                        |

### How to Disable

The `checkAlerts` task runs as a separate Node.js process
(`nx run @hyperdx/api:dev-task check-alerts`). In production it's started
alongside the main API. To disable:

1. **Don't start the task process** - remove the alert checker from the
   container entrypoint or process manager (Docker CMD, supervisor config, etc.)
2. **Casbin policy** - deny the `alerts` and `webhooks` resources for all roles,
   so the UI routes return 403 even if someone navigates to them:

```casbin
# No policy rules for alerts or webhooks - deny-by-default blocks them.
# Or explicitly if needed:
# p, deny, *, alerts, *
# p, deny, *, webhooks, *
```

### Why Not Remove the Code?

Additive-only principle. The alert models, controllers, routes, and frontend
components are all upstream code. If we delete or modify them, every upstream
merge that touches alerting (and upstream actively develops alerting features)
creates conflicts. By leaving the code in place but not running the task and
blocking API access via Casbin, we get the same result with zero fork
divergence.

### DFE Rules and Hunts Replace Alerting

The DFE platform provides:

- **Rules** - automated detection logic that queries ClickHouse directly from
  the Python platform, using the same team-scoped ClickHouse connection
  credentials. Rules are managed in the DFE UI, not in HyperDX.
- **Hunts** - interactive investigation workflows that combine queries across
  data sources. Hunts can reference HyperDX saved searches and dashboards via
  deep links.

HyperDX remains the **visualization and search layer** - users search logs, view
traces, build dashboards, and replay sessions. Detection and response logic
lives in the DFE platform.
