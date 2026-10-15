import { get, put, BlobPreconditionFailedError } from '@vercel/blob';
import { randomUUID } from 'node:crypto';

const options = { access: 'private', addRandomSuffix: false, contentType: 'application/json', cacheControlMaxAge: 60 };
export const blobClaims = {
  async read(key) {
    const result = await get(key, { access: 'private', useCache: false });
    if (!result) return null;
    if (result.statusCode !== 200) throw Error('Claim unavailable');
    return { claim: await new Response(result.stream).json(), etag: result.blob.etag };
  },
  async create(key, claim) {
    try { await put(key, JSON.stringify(claim), { ...options, allowOverwrite: false }); return true; }
    catch (error) { if (error instanceof BlobPreconditionFailedError || /already exists/.test(error.message)) return false; throw error; }
  },
  async replace(key, etag, claim) {
    try { await put(key, JSON.stringify(claim), { ...options, allowOverwrite: true, ifMatch: etag }); return true; }
    catch (error) { if (error instanceof BlobPreconditionFailedError) return false; throw error; }
  },
};

export function createClaimLedger(store = blobClaims) {
  const read = key => store.read(key);
  const write = async (key, current, patch) => {
    const next = { ...current.claim, ...patch, revision: randomUUID() };
    const won = await store.replace(key, current.etag, next);
    return { won, current: won ? { claim: next } : await read(key) };
  };
  const matches = (claim, binding) => claim && ['attemptId', 'generation', 'owner', 'digest'].every(key => claim[key] === binding[key]);
  return {
    read,
    matches,
    async allocate(key, binding, previous) {
      let current = await read(key);
      if (!current) {
        const claim = { version: 1, ...binding, phase: 'allocating', revision: randomUUID() };
        if (await store.create(key, claim)) return { claim };
        current = await read(key);
      }
      if (matches(current.claim, binding)) return current;
      if (current.claim.phase !== 'closed' || !previous || !matches(current.claim, previous)) throw Error('Claim owned');
      const result = await write(key, current, { ...binding, epoch: current.claim.epoch + 1, phase: 'allocating', sessionId: null, intent: null, closedAt: null });
      if (!result.won && !matches(result.current?.claim, binding)) throw Error('Claim changed');
      return result.current;
    },
    async transition(key, binding, from, patch) {
      const current = await read(key);
      if (!matches(current?.claim, binding)) throw Error('Claim owner changed');
      if (!from.includes(current.claim.phase)) return { won: false, current };
      return write(key, current, patch);
    },
  };
}
