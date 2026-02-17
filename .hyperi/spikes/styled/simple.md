# Restyle HyperDX, build standalone and reverse proxy to share the domain name hyperi.io/\*

## Project Setup

- Fork of [HyperDX](https://github.com/hyperdxio/hyperdx) observability platform
- Base: HyperDX monorepo (Next.js app, Express API, common-utils)
- Data stack: ClickHouse (telemetry), MongoDB (metadata), OpenTelemetry
  Collector

## Required changes

### Configurable Branding / Theming

HyperDX includes a built-in theme system supporting multiple brands:

- **NEXT_PUBLIC_THEME** env var selects theme at build time (`hyperdx` |
  `clickstack`)
- Theme config: `packages/app/src/theme/themes/{theme}/`
- Assets: favicons, Logomark, Wordmark, `_tokens.scss`, `mantineTheme.ts`
- Favicons live at `packages/app/public/favicons/{theme}/`

## Extended Branding / Theming

HyperDX color mode & theming does not match our core styling

- Adjust theme from sidebar instead of inside user preferences
- Sidebar collapse controls - adjust to be the same as ours

### RBAC

RBAC is not included in the open-source version as this has been reserved for
the enterprise offering - we will need to roll our own.

### Existing Features

HyperDX includes a number of features that may need to be trimmed down/removed

- User preferences (trim options), login/logout & team settings (trim options):
  this will need to be managed by control-plane/dfe-ui
  - User preferences: keep time format preferences, remove all appearance
    preferences, split out theme select into sidebar
  - Login/Logout: Remove all FE functionality - this will be handled by OAuth2 -
    see `.hyperi/spikes/oauth2-derek/HYPERDX-MIDDLEWARE.md`
  - Team settings: TBD
    - Remove all - all setup should be handled by HyperI (end-user should not be
      able to set these up)
    - Review if there are any features we would like to allow use to control
      (add a separate config area in dfe-ui so that we can use RBAC)
- Help Popup (remove) - all setup should be handled by HyperI (end-user should
  not be able to set these up)
- ✅ Deploy to clickhouse cloud banner (remove) | AppNavCloudBanner - all setup
  should be handled by HyperI (end-user should not be able to set these up)
- ✅ Get started banner (remove) | OnboardingChecklist - all setup should be
  handled by HyperI (end-user should not be able to set these up)
- ❓Presets (Clickhouse|Services|Kubernetes) - do we want to surface these to
  users? Do we need to consider RBAC?
- ❓Service Map - do we want to surface these to users? Do we need to consider
  RBAC?
- ❓Client sessions - do we want to surface these to users? Do we need to
  consider RBAC?
- Alerts (remove frontend functionality for now) - look at including later (we
  probably need to consider RBAC)

### Configuration requirements

- Team creation and configuration
  - Handled on organisation creation
- User creation
  - Handled on login/other
- Clickhouse connection
  - Handled on organisation creation
- Datasource creation
  - Handled on schema deployment for organisation

## Notable Files for Customization

| Area             | Location                                                    |
| ---------------- | ----------------------------------------------------------- |
| Theme registry   | `packages/app/src/theme/index.ts`                           |
| Theme components | `packages/app/src/theme/themes/{theme}/`                    |
| Page titles      | `theme.displayName` (from `_app.tsx`)                       |
| Hardcoded brand  | `LandingHeader.tsx`, `AuthPage.tsx`, `Spotlights.tsx`, etc. |
| External links   | `hyperdx.io`, `clickhouse.com/docs`                         |
| User preferences |
