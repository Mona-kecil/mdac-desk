import { defineEnvVars } from '@sveltejs/kit/env';
export const variables = defineEnvVars({
  MDAC_SESSION_SECRET: { schema: value => value },
  MDAC_CLAIM_NAMESPACE_SECRET: { schema: value => value },
  MDAC_BROWSER_SNAPSHOT_ID: { schema: value => value },
});
