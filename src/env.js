import { defineEnvVars } from '@sveltejs/kit/env';
export const variables = defineEnvVars({
  MDAC_SESSION_SECRET: {},
  MDAC_CLAIM_NAMESPACE_SECRET: {},
  MDAC_BROWSER_SNAPSHOT_ID: {},
});
