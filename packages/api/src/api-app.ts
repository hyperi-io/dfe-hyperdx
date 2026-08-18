import compression from 'compression';
import MongoStore from 'connect-mongo';
import express from 'express';
import session from 'express-session';
import onHeaders from 'on-headers';

import * as config from './config';
import {
  allowReadElseServicePrincipal,
  blockClickhouseProxyTest,
  requireServicePrincipal,
} from './dfe/middleware/admin-lockdown';
import { mountObservability } from './dfe/observability';
import queryExportRouter from './dfe/routers/query-export';
import mcpRouter from './mcp/app';
import { isUserAuthenticated } from './middleware/auth';
import defaultCors from './middleware/cors';
import { appErrorHandler } from './middleware/error';
import routers from './routers/api';
import clickhouseProxyRouter from './routers/api/clickhouseProxy';
import connectionsRouter from './routers/api/connections';
import favoritesRouter from './routers/api/favorites';
import pinnedFiltersRouter from './routers/api/pinnedFilters';
import savedSearchRouter from './routers/api/savedSearch';
import sourcesRouter from './routers/api/sources';
import externalRoutersV2 from './routers/external-api/v2';
import usageStats from './tasks/usageStats';
import logger, { expressLogger } from './utils/logger';
import passport from './utils/passport';

const app: express.Application = express();

const sess: session.SessionOptions & { cookie: session.CookieOptions } = {
  // Use a slot-specific cookie name in dev so multiple worktrees on localhost
  // don't overwrite each other's session cookies.
  ...(config.IS_DEV && process.env.HDX_DEV_SLOT
    ? { name: `connect.sid.${process.env.HDX_DEV_SLOT}` }
    : {}),
  resave: false,
  saveUninitialized: false,
  secret: config.EXPRESS_SESSION_SECRET,
  cookie: {
    secure: false,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
  },
  rolling: true,
  store: new MongoStore({ mongoUrl: config.MONGO_URI }),
};

app.set('trust proxy', 1);
if (!config.IS_CI && config.FRONTEND_URL) {
  const feUrl = new URL(config.FRONTEND_URL);
  sess.cookie.domain = feUrl.hostname;
  if (feUrl.protocol === 'https:') {
    sess.cookie.secure = true;
  }
}

app.disable('x-powered-by');
app.use(compression());

// DFE scalo observability surface (/livez, /readyz, /metrics). Mounted here,
// ahead of session/passport and the admin-lockdown middleware, because probes and
// scrapes are unauthenticated -- they must not hit passport or isUserAuthenticated.
mountObservability(app);

app.use(express.json({ limit: '32mb' }));
app.use(express.text({ limit: '32mb' }));
app.use(express.urlencoded({ extended: false, limit: '32mb' }));
app.use(session(sess));

if (!config.IS_LOCAL_APP_MODE) {
  app.use(passport.initialize());
  app.use(passport.session());
}

/* eslint-disable @typescript-eslint/no-require-imports */
// --- DFE START ---
// DFE OIDC identity middleware. When DFE_AUTH_MODE is unset, this block
// is skipped entirely and HyperDX behaves exactly as upstream.
// See docs/architecture/oidc-authentication.md for design details.
{
  const { isDfeEnabled } = require('./dfe/config');
  if (isDfeEnabled) {
    const { dfeIdentityMiddleware } = require('./dfe/middleware/jwt-verify');

    app.use(dfeIdentityMiddleware);
    logger.info('DFE: identity middleware enabled');
  }
}
// --- DFE END ---
/* eslint-enable @typescript-eslint/no-require-imports */

if (!config.IS_CI) {
  app.use(expressLogger);
}
// Allows timing data from frontend package
// see: https://github.com/expressjs/cors/issues/102
app.use(function (req, res, next) {
  onHeaders(res, function () {
    const allowOrigin = res.getHeader('Access-Control-Allow-Origin');
    if (allowOrigin) {
      res.setHeader('Timing-Allow-Origin', allowOrigin);
    }
  });
  next();
});
app.use(defaultCors);

// ---------------------------------------------------------------------
// ----------------------- Background Jobs -----------------------------
// ---------------------------------------------------------------------
if (config.USAGE_STATS_ENABLED && !config.IS_CI) {
  usageStats();
}
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// ----------------------- Internal Routers ----------------------------
// ---------------------------------------------------------------------
// PUBLIC ROUTES
app.use('/', routers.rootRouter);

// SELF-AUTHENTICATED ROUTES (validated via access key, not session middleware)
// DFE: MCP rides the personal access key and is an agent/admin surface, so it is
// engine-only in DFE mode (requireServicePrincipal is a no-op otherwise).
app.use('/mcp', requireServicePrincipal, mcpRouter);

// PRIVATE ROUTES
app.use('/ai', isUserAuthenticated, routers.aiRouter);
// DFE: admin surfaces (alerts, team, webhooks, connections, sources) are
// engine-only. requireServicePrincipal is a no-op when DFE auth is off.
app.use(
  '/alerts',
  isUserAuthenticated,
  requireServicePrincipal,
  routers.alertsRouter,
);
app.use('/dashboards', isUserAuthenticated, routers.dashboardRouter);
app.use('/me', isUserAuthenticated, routers.meRouter);
app.use(
  '/team',
  isUserAuthenticated,
  requireServicePrincipal,
  routers.teamRouter,
);
app.use(
  '/webhooks',
  isUserAuthenticated,
  requireServicePrincipal,
  routers.webhooksRouter,
);
app.use(
  '/connections',
  isUserAuthenticated,
  requireServicePrincipal,
  connectionsRouter,
);
// /sources is READ-open to a human (the embedded search UI lists its own team's
// sources) but WRITE-locked to the engine; the read is team-scoped + secret-free.
app.use(
  '/sources',
  isUserAuthenticated,
  allowReadElseServicePrincipal,
  sourcesRouter,
);
app.use('/saved-search', isUserAuthenticated, savedSearchRouter);
app.use('/favorites', isUserAuthenticated, favoritesRouter);
app.use('/pinned-filters', isUserAuthenticated, pinnedFiltersRouter);
// DFE: the connection tester sub-route is admin; the rest of the proxy stays open.
app.use(
  '/clickhouse-proxy',
  isUserAuthenticated,
  blockClickhouseProxyTest,
  clickhouseProxyRouter,
);
if (config.IS_PROMQL_ENABLED) {
  app.use('/v1/prometheus', isUserAuthenticated, routers.prometheusRouter);
}

// --- DFE ROUTES START ---

app.use('/dfe', isUserAuthenticated, queryExportRouter);
// --- DFE ROUTES END ---
// ---------------------------------------------------------------------

// TODO: Separate external API routers from internal routers
// ---------------------------------------------------------------------
// ----------------------- External Routers ----------------------------
// ---------------------------------------------------------------------
// API v2
// Only initialize Swagger in development or if explicitly enabled
if (
  process.env.NODE_ENV !== 'production' &&
  process.env.ENABLE_SWAGGER === 'true'
) {
  // Will require a refactor to ESM to use import statements
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setupSwagger } = require('./utils/swagger');
  setupSwagger(app);
  logger.info('Swagger UI setup and available at /api/v2/docs');
}

// DFE: the external API rides the personal access key; engine-only in DFE mode.
app.use('/api/v2', requireServicePrincipal, externalRoutersV2);

// error handling
app.use(appErrorHandler);

export default app;
