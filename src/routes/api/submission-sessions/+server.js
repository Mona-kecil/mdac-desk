import { createSession } from '#lib/server/submission/gateway.js';
import { boundary } from '#lib/server/submission/http.js';
export const POST = event => boundary(event, (capability, body) => createSession(body, capability));
