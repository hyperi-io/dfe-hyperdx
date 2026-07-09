// DFE Configuration
// All DFE-specific environment variables are read here.
// When DFE_AUTH_MODE is unset, all DFE middleware is disabled and
// HyperDX behaves exactly as upstream.

const env = process.env;

export const DFE_AUTH_MODE = env.DFE_AUTH_MODE as 'oidc-proxy' | undefined;

export const DFE_AUTH_HEADER_EMAIL =
  env.DFE_AUTH_HEADER_EMAIL || 'x-forwarded-email';

export const DFE_AUTH_HEADER_GROUPS =
  env.DFE_AUTH_HEADER_GROUPS || 'x-forwarded-groups';

export const DFE_AUTH_DEFAULT_TEAM = env.DFE_AUTH_DEFAULT_TEAM as
  | string
  | undefined;

export const isDfeEnabled = DFE_AUTH_MODE === 'oidc-proxy';
