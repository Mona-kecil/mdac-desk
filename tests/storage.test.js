import 'fake-indexeddb/auto';
import {describe,it,expect} from 'vitest';
import {createRepository} from '../src/lib/storage/repository.js';
import {malaysiaToday} from '../src/lib/domain/validate.js';
const profile = {name:'TEST PERSON',passportNo:'00123456',birthDate:'2000-01-01',nationality:'IDN',birthPlace:'IDN',sex:'1',passportExpiry:'2035-01-01',email:'test@example.com',phoneCountry:'62',phone:'0012345678',reviewedAt:new Date().toISOString()};
const trip = {arrival:malaysiaToday(),departure:malaysiaToday(),transportNo:'TEST123',travelMode:'1',embarkation:'IDN',accommodationKind:'01',address1:'ONE TEST ROAD',address2:'',state:'14',city:'1400',postcode:'00100'};
const repo = () => createRepository(crypto.randomUUID());
describe('browser record ownership',()=>{
  it('deduplicates profile imports across repository instances',async()=>{
    const name=crypto.randomUUID();const a=createRepository(name);const b=createRepository(name);
    await Promise.all([a.saveProfile(profile),b.saveProfile(profile)]);
    expect(await a.listProfiles()).toHaveLength(1);
    expect((await a.listProfiles())[0].passportNo).toBe('00123456');
  });
  it('queues immutable snapshots and rejects duplicate trip attempts across tabs',async()=>{
    const name=crypto.randomUUID();const a=createRepository(name);const b=createRepository(name);
    const saved=await a.saveProfile(profile);
    const results=await Promise.allSettled([a.queue([saved],trip),b.queue([saved],trip)]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    await a.saveProfile({...saved,name:'CHANGED NAME'});
    const [submission]=await a.listSubmissions();
    expect(submission.profileSnapshot.name).toBe('TEST PERSON');
    expect(submission.tripSnapshot.postcode).toBe('00100');
    expect(submission.state).toBe('queued');
  });
  it('merges backups idempotently and records event evidence once',async()=>{
    const source=repo();const target=repo();const saved=await source.saveProfile(profile);const [submission]=await source.queue([saved],trip);
    const e={id:'fill-event',attemptId:submission.id,type:'filling',at:new Date().toISOString()};
    await source.appendEvent(submission.id,e);await source.appendEvent(submission.id,e);
    expect((await source.listSubmissions())[0].events).toHaveLength(1);
    const backup=await source.exportBackup();
    expect(await target.restoreBackup(backup)).toEqual({profiles:1,submissions:1});
    expect(await target.restoreBackup(backup)).toEqual({profiles:0,submissions:0});
    expect((await target.listSubmissions())[0].state).toBe('blocked');
  });
  it('rolls back a malformed backup and refuses draft queueing',async()=>{
    const store=repo();const saved=await store.saveProfile({...profile,reviewedAt:null});
    await expect(store.queue([saved],trip)).rejects.toThrow('belum lengkap dan ditinjau');
    const backup=await store.exportBackup();backup.submissions=[{id:'broken'}];
    const target=repo();await expect(target.restoreBackup(backup)).rejects.toThrow();expect(await target.listProfiles()).toEqual([]);
  });
});
