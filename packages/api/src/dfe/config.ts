// DFE Configuration
// All DFE-specific environment variables are read here.
// When DFE_AUTH_MODE is unset, all DFE middleware is disabled and
// HyperDX behaves exactly as upstream.

const env = process.env;

// DFE_AUTH_MODE selects the identity strategy:
//   - 'oidc-proxy' : verify the engine's ES384 JWT (defence-in-depth PEP;
//                    Envoy already verified it at the edge). This is the
//                    default DFE behaviour.
//   - 'header-dev' : DEV-ONLY fallback that trusts DFE_AUTH_HEADER_EMAIL /
//                    _GROUPS without cryptographic verification, so local
//                    dev works without a running engine. Never for prod.
//   - undefined    : DFE middleware disabled; upstream HyperDX behaviour.
const DFE_AUTH_MODES = ['oidc-proxy', 'header-dev'] as const;
export type DfeAuthMode = (typeof DFE_AUTH_MODES)[number];

// Narrowed by CHECKING the value, not by asserting it. A cast told the compiler
// this was one of the two modes without looking, so a typo (`oidc_proxy`) typed
// as valid and then matched neither branch - disabling the PEP with no warning.
// It still ends up disabled, but now that is a value we actually read as unset.
export const DFE_AUTH_MODE: DfeAuthMode | undefined = DFE_AUTH_MODES.find(
  mode => mode === env.DFE_AUTH_MODE,
);

export const DFE_AUTH_HEADER_EMAIL =
  env.DFE_AUTH_HEADER_EMAIL || 'x-forwarded-email';

export const DFE_AUTH_HEADER_GROUPS =
  env.DFE_AUTH_HEADER_GROUPS || 'x-forwarded-groups';

export const DFE_AUTH_DEFAULT_TEAM = env.DFE_AUTH_DEFAULT_TEAM as
  | string
  | undefined;

// Engine JWT verification (DFE_AUTH_MODE=oidc-proxy). The engine is the
// single JWT issuer; hyperdx verifies its ES384 token against the engine's
// JWKS. DFE_ENGINE_ISSUER, when set, is enforced as the `iss` claim.
export const DFE_ENGINE_JWKS_URL = env.DFE_ENGINE_JWKS_URL as
  | string
  | undefined;

export const DFE_ENGINE_ISSUER = env.DFE_ENGINE_ISSUER as string | undefined;

export const isDfeEnabled =
  DFE_AUTH_MODE === 'oidc-proxy' || DFE_AUTH_MODE === 'header-dev';
