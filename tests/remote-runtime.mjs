import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { Sandbox } from '@vercel/sandbox';
import { get, del } from '@vercel/blob';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const vite = await createServer({ configFile: false, server: { middlewareMode: true }, plugins: [{
  name: 'fixture-private-env',
  resolveId(id) { if (id === '$app/env/private') return '\0fixture-private-env'; },
  load(id) { if (id === '\0fixture-private-env') return ['MDAC_SESSION_SECRET','MDAC_CLAIM_NAMESPACE_SECRET','MDAC_BROWSER_SNAPSHOT_ID'].map(key => `export const ${key} = process.env.${key};`).join('\n'); },
}] });
const gateway = await vite.ssrLoadModule('/src/lib/server/submission/gateway.js');
const fixture = await readFile(new URL('./fixtures/remote-form.html', import.meta.url), 'utf8');
const capability = randomBytes(32).toString('base64url');
const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const raw = { generation: randomUUID(), submission: { id: randomUUID(), profileSnapshot: {name:'TEST TRAVELLER',passportNo:`T${Date.now().toString().slice(-9)}`,birthDate:'1990-01-02',nationality:'IDN',birthPlace:'IDN',sex:'1',passportExpiry:'2030-01-01',email:'test@example.invalid',phoneCountry:'62',phone:'08123456789'},tripSnapshot:{arrival:today,departure:today,transportNo:'TEST 123',travelMode:'1',embarkation:'IDN',accommodationKind:'01',address1:'TEST HOTEL ROAD',address2:'',state:'14',city:'1401',postcode:'05000'}} };
let handle, binding;
const proof = { fixtureOnly: true, checks: [] };
const check = (name, value) => { assert.ok(value, name); proof.checks.push(name); console.log(name); };
const decode = handle => JSON.parse(Buffer.from(handle.split('.')[0], 'base64url'));
const state = () => gateway.sessionAction(handle, capability, 'status');
const command = (action, body) => gateway.sessionAction(handle, capability, action, body);
async function fixtureState() {
  const sandbox = await Sandbox.get({name:binding.vmName,resume:false});
  const relay = createHmac('sha256',process.env.MDAC_SESSION_SECRET).update(`relay-v1:${binding.owner}`).digest('base64url');
  const response=await fetch(`${sandbox.domain(3000)}/fixture-state`,{headers:{Authorization:`Bearer ${relay}`}});
  assert.equal(response.status,200); return response.json();
}
try {
  const results = await Promise.all([gateway.createSession(raw,capability,fixture),gateway.createSession(raw,capability,fixture)]);
  handle=results[0].handle;binding=decode(handle);
  check('duplicate create keeps one generation',decode(results[1].handle).vmName===binding.vmName);
  let current;
  for(let n=0;n<35;n++){current=await state();if(current.phase==='awaiting_verification'||current.phase==='blocked')break;await new Promise(resolve=>setTimeout(resolve,500));}
  assert.equal(current.phase,'awaiting_verification',JSON.stringify(current));
  let details=await fixtureState();
  check('dependent live options and exact readback',details.passport===raw.submission.profileSnapshot.passportNo&&details.region==='62'&&details.city==='1401'&&details.postcode==='05000');
  const replay=await state();check('exact event replay before ACK',JSON.stringify(current.events)===JSON.stringify(replay.events));
  await assert.rejects(()=>gateway.sessionAction(handle,randomBytes(32).toString('base64url'),'status'));proof.checks.push('cross-owner refused');
  await assert.rejects(()=>gateway.createSession({...raw,submission:{...raw.submission,profileSnapshot:{...raw.submission.profileSnapshot,name:'CHANGED NAME'}}},capability,fixture));proof.checks.push('changed digest refused');
  const frame=await command('frame');
  await writeFile('/tmp/mdac-redesign/remote-fixture.jpg',Buffer.from(frame.image,'base64'));
  await assert.rejects(()=>command('input',{type:'down',x:10,y:10,generation:'stale',sequence:1}));proof.checks.push('stale frame refused');
  let sequence=0;
  const x=details.slider.x-details.captcha.x+20,y=details.slider.y-details.captcha.y+20;
  // Same transform used by the image at 300 CSS pixels on a 360px mobile screen.
  const scale=300/frame.width;
  const pointer=async(type,dx)=>command('input',{type,x:((x+dx)*scale)/scale,y:(y*scale)/scale,generation:frame.generation,sequence:++sequence});
  await pointer('down',0);await pointer('move',100);await pointer('move',200);await pointer('move',288);await pointer('up',288);
  for(let n=0;n<20;n++){current=await state();if(current.events.some(event=>event.type==='click_intent'))break;await new Promise(resolve=>setTimeout(resolve,300));}
  const intent=current.events.find(event=>event.type==='click_intent');assert.ok(intent);
  details=await fixtureState();check('withheld local ACK has zero native clicks',details.clicks===0);
  check('mobile pointer mapping reaches real fixture gesture',Boolean(intent));
  check('reload replays identical stable intent',JSON.stringify((await state()).events)===JSON.stringify(current.events));
  for(const event of current.events.filter(event=>event.type!=='click_intent'))await command('ack',{eventId:event.id});
  await command('ack',{eventId:intent.id});
  for(let n=0;n<15;n++){details=await fixtureState();if(details.clicks)break;await new Promise(resolve=>setTimeout(resolve,150));}
  check('released durable ACK permits exactly one native click',details.clicks===1);
  await command('ack',{eventId:intent.id});await command('ack',{eventId:intent.id});
  check('repeated ACK does not click twice',(await fixtureState()).clicks===1);
  current=await state();check('dispatch remains outcome unknown',current.events.some(event=>event.type==='outcome_unknown'));
  const claimResult=await get(binding.key,{access:'private',useCache:false});const claim=await new Response(claimResult.stream).json();
  check('private durable claim is spent',claim.phase==='spent');
  check('claim contains no passport or image',!JSON.stringify(claim).includes(raw.submission.profileSnapshot.passportNo)&&!JSON.stringify(claim).includes('image'));
  for(const event of current.events)await command('ack',{eventId:event.id});
  const closed=await state();check('stopped or deleted worker preserves spent fence',closed.closed&&closed.intent?.id===intent.id);
  await assert.rejects(()=>gateway.createSession({...raw,generation:randomUUID()},randomBytes(32).toString('base64url'),fixture));proof.checks.push('spent fingerprint blocks new owner');
} finally {
  if(binding){try{const box=await Sandbox.get({name:binding.vmName,resume:false});if(box.status==='running')await box.stop();await box.delete();}catch{} const current=await get(binding.key,{access:'private',useCache:false});if(current)await del(binding.key,{ifMatch:current.blob.etag});}
  await writeFile('/tmp/mdac-redesign/remote-runtime-proof.json',JSON.stringify(proof,null,2));
  await vite.close();
}
