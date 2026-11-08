import assert from 'node:assert/strict';
import { startLocalActor } from './local-actor.mjs';

const actor = await startLocalActor({ readOnly: true, submission: { id: 'read-only' } });
try {
  let state;
  for (let n = 0; n < 100; n++) {
    state = await actor.call('status');
    if (state.phase === 'readonly' || state.phase === 'blocked') break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(state.phase, 'readonly');
  const puzzle = await actor.call('challenge');
  assert.ok(puzzle.id && puzzle.width > 60 && puzzle.height > 0 && puzzle.pieceWidth < puzzle.width);
  for (const image of [puzzle.background, puzzle.piece]) assert.equal(Buffer.from(image, 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(puzzle.track, puzzle.width - 40);
  assert.equal(puzzle.ratio, (puzzle.width - 60) / (puzzle.width - 40));
  console.log(JSON.stringify({ readOnly: true, blockedNonGet: true, width: puzzle.width, height: puzzle.height, pieceWidth: puzzle.pieceWidth, images: 'PNG', submitted: false }));
} finally { await actor.stop(); }
