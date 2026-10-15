import { sessionAction } from '#lib/server/submission/gateway.js';
import { boundary } from '#lib/server/submission/http.js';
const serve = event => boundary(event, (capability, body) => sessionAction(event.params.handle, capability, event.params.action, body));
export const GET = serve;
export const POST = serve;
