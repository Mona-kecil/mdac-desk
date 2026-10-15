import { openDB } from 'idb';
import { PROFILE_FIELDS, TRIP_FIELDS, STATES } from '../domain/schema.js';
import { validateProfile, validateTrip, fingerprint } from '../domain/validate.js';
import { reduceAttempt } from '../domain/state.js';
const clone = value => structuredClone(value);
const pick = (value, fields) => Object.fromEntries(fields.map(field => [field, typeof value[field] === 'string' ? value[field].trim() : '']));
const identity = profile => profile.nationality && profile.passportNo ? `${profile.nationality}|${profile.passportNo.toUpperCase()}` : undefined;
export function createRepository(name = 'mdac-desk') {
  const database = openDB(name, 1, {upgrade(db) {
    const profiles = db.createObjectStore('profiles', {keyPath:'id'});
    profiles.createIndex('identity','identity',{unique:true});
    const submissions = db.createObjectStore('submissions',{keyPath:'id'});
    submissions.createIndex('fingerprint','fingerprint',{unique:true});
  }});
  const list = async store => (await (await database).getAll(store)).sort((a,b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
  return {
    listProfiles: () => list('profiles'),
    listSubmissions: () => list('submissions'),
    async saveProfile(input) {
      const db = await database;
      const tx = db.transaction('profiles','readwrite');
      const fields = pick(input,PROFILE_FIELDS);
      fields.passportNo = fields.passportNo.toUpperCase();
      const key = identity(fields);
      const duplicate = key ? await tx.store.index('identity').get(key) : undefined;
      const previous = input.id ? await tx.store.get(input.id) : duplicate;
      if (duplicate && input.id && duplicate.id !== input.id) { tx.abort(); throw new Error('Paspor dan kewarganegaraan sudah ada dalam profil lain.'); }
      const result = {...fields,id:previous?.id || crypto.randomUUID(),revision:(previous?.revision || 0)+1,updatedAt:new Date().toISOString(),reviewedAt:input.reviewedAt || null};
      if (key) result.identity = key;
      await tx.store.put(result); await tx.done;
      return clone(result);
    },
    async deleteProfile(id) { await (await database).delete('profiles',id); },
    async queue(profiles,trip) {
      if (!Array.isArray(profiles) || !profiles.length) throw new Error('Pilih setidaknya satu penumpang.');
      const tripIssues = validateTrip(trip);
      if (tripIssues.length) throw new Error(tripIssues.join(' '));
      const db = await database;
      const tx = db.transaction(['profiles','submissions'],'readwrite');
      const store = tx.objectStore('submissions');
      const output = [];
      try {
        if ((await store.getAll()).some(record => ['submitting','outcome_unknown'].includes(record.state))) throw new Error('Periksa hasil pengiriman yang belum diketahui sebelum menambah antrean.');
        for (const supplied of profiles) {
          const profile = await tx.objectStore('profiles').get(supplied.id);
          if (!profile || profile.revision !== supplied.revision) throw new Error('Profil berubah di tab lain. Muat ulang daftar penumpang.');
          const issues = validateProfile(profile);
          if (issues.length || !profile.reviewedAt) throw new Error(`${profile.name || 'Profil'} belum lengkap dan ditinjau. ${issues.join(' ')}`);
          const key = fingerprint(profile,trip);
          if (await store.index('fingerprint').getKey(key)) throw new Error(`${profile.name} sudah memiliki catatan untuk tanggal tiba ini.`);
          const now = new Date().toISOString();
          const record = {id:crypto.randomUUID(),profileId:profile.id,profileSnapshot:clone(profile),tripSnapshot:pick(trip,TRIP_FIELDS),fingerprint:key,reviewedAt:now,createdAt:now,state:'queued',events:[]};
          await store.add(record); output.push(record);
        }
        await tx.done; return clone(output);
      } catch(error) { tx.abort(); await tx.done.catch(()=>{}); throw error; }
    },
    async appendEvent(id,event) {
      const db = await database; const tx = db.transaction('submissions','readwrite');
      const current = await tx.store.get(id);
      if (!current) {tx.abort(); throw new Error('Catatan pengiriman tidak ditemukan.');}
      let result;
      try { result = reduceAttempt(current,event); } catch(error) {tx.abort(); await tx.done.catch(()=>{}); throw error;}
      await tx.store.put(result); await tx.done; return clone(result);
    },
    async deleteSubmission(id) {
      const db = await database; const tx = db.transaction('submissions','readwrite'); const current = await tx.store.get(id);
      if (current && ['filling','awaiting_verification','submitting','outcome_unknown'].includes(current.state)) {tx.abort(); await tx.done.catch(()=>{}); throw new Error('Hentikan atau rekonsiliasi pengiriman aktif sebelum menghapusnya.');}
      await tx.store.delete(id); await tx.done;
    },
    async exportBackup() { return {format:'mdac-desk',version:1,exportedAt:new Date().toISOString(),profiles:await list('profiles'),submissions:await list('submissions')}; },
    async restoreBackup(backup) {
      if (backup?.format !== 'mdac-desk' || backup.version !== 1 || !Array.isArray(backup.profiles) || !Array.isArray(backup.submissions) || backup.profiles.length > 10000 || backup.submissions.length > 10000) throw new Error('Format cadangan tidak valid.');
      const db = await database; const tx = db.transaction(['profiles','submissions'],'readwrite');
      const count = {profiles:0,submissions:0};
      try {
        for (const raw of backup.profiles) {
          if (typeof raw.id !== 'string' || !raw.id || !Number.isInteger(raw.revision) || !Number.isFinite(Date.parse(raw.updatedAt))) throw new Error('Profil cadangan tidak valid.');
          const record = {...pick(raw,PROFILE_FIELDS),id:raw.id,revision:raw.revision,updatedAt:raw.updatedAt,reviewedAt:raw.reviewedAt || null};
          const key = identity(record); if (key) record.identity = key;
          const store = tx.objectStore('profiles');
          if (await store.get(raw.id) || (key && await store.index('identity').getKey(key))) continue;
          await store.add(record); count.profiles++;
        }
        for (const raw of backup.submissions) {
          if (typeof raw.id !== 'string' || !STATES.includes(raw.state) || !raw.profileSnapshot || !raw.tripSnapshot || !Array.isArray(raw.events) || raw.events.length > 1000 || !Number.isFinite(Date.parse(raw.createdAt))) throw new Error('Riwayat cadangan tidak valid.');
          const store = tx.objectStore('submissions');
          const key = fingerprint(raw.profileSnapshot,raw.tripSnapshot);
          const existing = await store.get(raw.id) || await store.index('fingerprint').get(key);
          if (existing) {
            if (existing.id !== raw.id || JSON.stringify(existing.profileSnapshot) !== JSON.stringify(raw.profileSnapshot) || JSON.stringify(existing.tripSnapshot) !== JSON.stringify(raw.tripSnapshot)) continue;
            let merged = existing;
            for (const event of raw.events) merged = reduceAttempt(merged,event);
            await store.put(merged); continue;
          }
          let restored = {id:raw.id,profileId:raw.profileId,profileSnapshot:clone(raw.profileSnapshot),tripSnapshot:clone(raw.tripSnapshot),fingerprint:key,reviewedAt:raw.reviewedAt,createdAt:raw.createdAt,state:'queued',events:[]};
          for (const event of raw.events) restored = reduceAttempt(restored,event);
          if (restored.state !== raw.state) throw new Error('Status cadangan tidak cocok dengan jurnal.');
          if (['filling','awaiting_verification'].includes(restored.state)) restored = reduceAttempt(restored,{id:crypto.randomUUID(),attemptId:restored.id,type:'blocked',at:new Date().toISOString(),detail:'Dipulihkan dari cadangan. Mulai ulang secara manual.'});
          if (restored.state === 'submitting') restored = reduceAttempt(restored,{id:crypto.randomUUID(),attemptId:restored.id,type:'outcome_unknown',at:new Date().toISOString(),detail:'Cadangan memuat niat klik. Periksa di situs resmi.'});
          await store.add(restored); count.submissions++;
        }
        await tx.done; return count;
      } catch(error) {tx.abort(); await tx.done.catch(()=>{}); throw error;}
    },
    async clearAll() { const db = await database; const tx = db.transaction(['profiles','submissions'],'readwrite'); await tx.objectStore('profiles').clear(); await tx.objectStore('submissions').clear(); await tx.done; }
  };
}
