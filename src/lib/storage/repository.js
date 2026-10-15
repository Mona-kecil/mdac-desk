import { openDB } from "idb";
import { PROFILE_FIELDS, TRIP_FIELDS, STATES } from "../domain/schema.js";
import {
  validateProfile,
  validateTrip,
  fingerprint,
  isISODate,
} from "../domain/validate.js";
import { reduceAttempt, isInstant } from "../domain/state.js";
const clone = (value) => structuredClone(value);
const validFields = (value, fields) =>
  value &&
  fields.every(
    (field) => typeof value[field] === "string" && value[field].length <= 1000,
  );
const validProfileMetadata = (value) =>
  typeof value.id === "string" &&
  value.id.length > 0 &&
  value.id.length <= 100 &&
  Number.isInteger(value.revision) &&
  value.revision > 0 &&
  isInstant(value.updatedAt) &&
  (value.reviewedAt == null || isInstant(value.reviewedAt));
const pick = (value, fields) =>
  Object.fromEntries(
    fields.map((field) => [
      field,
      typeof value[field] === "string" ? value[field].trim() : "",
    ]),
  );
function normalizeRestored(record) {
  const type = ["filling", "awaiting_verification"].includes(record.state)
    ? "blocked"
    : record.state === "submitting"
      ? "outcome_unknown"
      : null;
  if (!type) return record;
  return reduceAttempt(record, {
    id: crypto.randomUUID(),
    attemptId: record.id,
    type,
    at: new Date().toISOString(),
    generatedBy: "restore",
    recoveryFromState: record.state,
    detail: "Dipulihkan dari cadangan. Periksa sebelum melanjutkan.",
  });
}
function retainIncomingClick(existing, incoming) {
  if (!incoming.submittedAt) return normalizeRestored(existing);
  const evidenceKey = `${incoming.fingerprint}@${incoming.submittedAt}`;
  if (
    existing.events.some(
      (event) => event.conflictEvidenceKey === evidenceKey,
    ) ||
    existing.submittedAt === incoming.submittedAt
  )
    return normalizeRestored(existing);
  return reduceAttempt(existing, {
    id: crypto.randomUUID(),
    attemptId: existing.id,
    type: "backup_conflict",
    at: new Date().toISOString(),
    conflictClickAt: incoming.submittedAt,
    conflictEvidenceKey: evidenceKey,
    conflictSourceEventId: incoming.events.at(-1).id,
    sourceAttemptId: incoming.id,
    detail:
      "Cadangan untuk paspor dan tanggal tiba yang sama memuat niat klik. Antrean dihentikan. Periksa Check Registration.",
  });
}
const identity = (profile) =>
  profile.nationality && profile.passportNo
    ? `${profile.nationality}|${profile.passportNo.toUpperCase()}`
    : undefined;
export function createRepository(name = "mdac-desk") {
  const database = openDB(name, 1, {
    upgrade(db) {
      const profiles = db.createObjectStore("profiles", { keyPath: "id" });
      profiles.createIndex("identity", "identity", { unique: true });
      const submissions = db.createObjectStore("submissions", {
        keyPath: "id",
      });
      submissions.createIndex("fingerprint", "fingerprint", { unique: true });
    },
  });
  const list = async (store) =>
    (await (await database).getAll(store)).sort((a, b) =>
      (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt),
    );
  return {
    listProfiles: () => list("profiles"),
    listSubmissions: () => list("submissions"),
    async saveProfile(input) {
      const db = await database;
      const tx = db.transaction("profiles", "readwrite");
      const fields = pick(input, PROFILE_FIELDS);
      fields.passportNo = fields.passportNo.toUpperCase();
      fields.name = fields.name.toUpperCase();
      const key = identity(fields);
      const duplicate = key
        ? await tx.store.index("identity").get(key)
        : undefined;
      if (duplicate && !input.id) {
        await tx.done;
        return clone(duplicate);
      }
      const previous = input.id ? await tx.store.get(input.id) : undefined;
      if (duplicate && input.id && duplicate.id !== input.id) {
        tx.abort();
        throw new Error(
          "Paspor dan kewarganegaraan sudah ada dalam profil lain.",
        );
      }
      const result = {
        ...fields,
        id: previous?.id || crypto.randomUUID(),
        revision: (previous?.revision || 0) + 1,
        updatedAt: new Date().toISOString(),
        reviewedAt: input.reviewedAt || null,
      };
      if (key) result.identity = key;
      await tx.store.put(result);
      await tx.done;
      return clone(result);
    },
    async deleteProfile(id) {
      await (await database).delete("profiles", id);
    },
    async queue(profiles, trip) {
      if (!Array.isArray(profiles) || !profiles.length)
        throw new Error("Pilih setidaknya satu penumpang.");
      const tripIssues = validateTrip(trip);
      if (tripIssues.length) throw new Error(tripIssues.join(" "));
      const db = await database;
      const tx = db.transaction(["profiles", "submissions"], "readwrite");
      const store = tx.objectStore("submissions");
      const output = [];
      try {
        if (
          (await store.getAll()).some((record) =>
            ["submitting", "outcome_unknown"].includes(record.state),
          )
        )
          throw new Error(
            "Periksa hasil pengiriman yang belum diketahui sebelum menambah antrean.",
          );
        for (const supplied of profiles) {
          const profile = await tx.objectStore("profiles").get(supplied.id);
          if (!profile || profile.revision !== supplied.revision)
            throw new Error(
              "Profil berubah di tab lain. Muat ulang daftar penumpang.",
            );
          const issues = validateProfile(profile);
          if (issues.length || !profile.reviewedAt)
            throw new Error(
              `${profile.name || "Profil"} belum lengkap dan ditinjau. ${issues.join(" ")}`,
            );
          const key = fingerprint(profile, trip);
          if (await store.index("fingerprint").getKey(key))
            throw new Error(
              `${profile.name} sudah memiliki catatan untuk tanggal tiba ini.`,
            );
          const now = new Date().toISOString();
          const record = {
            id: crypto.randomUUID(),
            profileId: profile.id,
            profileSnapshot: clone(profile),
            tripSnapshot: {
              ...pick(trip, TRIP_FIELDS),
              transportNo: trip.transportNo.toUpperCase(),
              address1: trip.address1.toUpperCase(),
              address2: (trip.address2 || "").toUpperCase(),
            },
            fingerprint: key,
            reviewedAt: now,
            createdAt: now,
            state: "queued",
            events: [],
          };
          await store.add(record);
          output.push(record);
        }
        await tx.done;
        return clone(output);
      } catch (error) {
        tx.abort();
        await tx.done.catch(() => {});
        throw error;
      }
    },
    async appendEvent(id, event) {
      const db = await database;
      const tx = db.transaction("submissions", "readwrite");
      const current = await tx.store.get(id);
      if (!current) {
        tx.abort();
        throw new Error("Catatan pengiriman tidak ditemukan.");
      }
      let result;
      try {
        result = reduceAttempt(current, event);
      } catch (error) {
        tx.abort();
        await tx.done.catch(() => {});
        throw error;
      }
      await tx.store.put(result);
      await tx.done;
      return clone(result);
    },
    async deleteSubmission(id) {
      const db = await database;
      const tx = db.transaction("submissions", "readwrite");
      const current = await tx.store.get(id);
      if (
        current &&
        [
          "filling",
          "awaiting_verification",
          "submitting",
          "outcome_unknown",
        ].includes(current.state)
      ) {
        tx.abort();
        await tx.done.catch(() => {});
        throw new Error(
          "Hentikan atau rekonsiliasi pengiriman aktif sebelum menghapusnya.",
        );
      }
      await tx.store.delete(id);
      await tx.done;
    },
    async exportBackup() {
      return {
        format: "mdac-desk",
        version: 1,
        exportedAt: new Date().toISOString(),
        profiles: await list("profiles"),
        submissions: await list("submissions"),
      };
    },
    async restoreBackup(backup) {
      if (
        backup?.format !== "mdac-desk" ||
        backup.version !== 1 ||
        !Array.isArray(backup.profiles) ||
        !Array.isArray(backup.submissions) ||
        backup.profiles.length > 10000 ||
        backup.submissions.length > 10000
      )
        throw new Error("Format cadangan tidak valid.");
      const db = await database;
      const tx = db.transaction(["profiles", "submissions"], "readwrite");
      const count = { profiles: 0, submissions: 0 };
      try {
        for (const raw of backup.profiles) {
          if (!validFields(raw, PROFILE_FIELDS) || !validProfileMetadata(raw))
            throw new Error("Profil cadangan tidak valid.");
          const record = {
            ...pick(raw, PROFILE_FIELDS),
            id: raw.id,
            revision: raw.revision,
            updatedAt: raw.updatedAt,
            reviewedAt: raw.reviewedAt || null,
          };
          const key = identity(record);
          if (key) record.identity = key;
          const store = tx.objectStore("profiles");
          if (
            (await store.get(raw.id)) ||
            (key && (await store.index("identity").getKey(key)))
          )
            continue;
          await store.add(record);
          count.profiles++;
        }
        for (const raw of backup.submissions) {
          if (
            typeof raw.id !== "string" ||
            !raw.id ||
            raw.id.length > 100 ||
            !STATES.includes(raw.state) ||
            !raw.profileSnapshot ||
            !raw.tripSnapshot ||
            !Array.isArray(raw.events) ||
            raw.events.length > 1000 ||
            !isInstant(raw.createdAt) ||
            !isInstant(raw.reviewedAt)
          )
            throw new Error("Riwayat cadangan tidak valid.");
          if (
            !validFields(raw.profileSnapshot, PROFILE_FIELDS) ||
            !validProfileMetadata(raw.profileSnapshot) ||
            !isInstant(raw.profileSnapshot.reviewedAt) ||
            raw.profileId !== raw.profileSnapshot.id ||
            PROFILE_FIELDS.some(
              (field) => !raw.profileSnapshot[field].trim(),
            ) ||
            !validFields(raw.tripSnapshot, TRIP_FIELDS) ||
            TRIP_FIELDS.some(
              (field) =>
                field !== "address2" && !raw.tripSnapshot[field].trim(),
            ) ||
            !isISODate(raw.profileSnapshot.birthDate) ||
            !isISODate(raw.profileSnapshot.passportExpiry) ||
            !isISODate(raw.tripSnapshot.arrival) ||
            !isISODate(raw.tripSnapshot.departure)
          )
            throw new Error("Snapshot cadangan tidak valid.");
          const store = tx.objectStore("submissions");
          const key = fingerprint(raw.profileSnapshot, raw.tripSnapshot);
          const existing =
            (await store.get(raw.id)) ||
            (await store.index("fingerprint").get(key));
          let restored = {
            id: raw.id,
            profileId: raw.profileId,
            profileSnapshot: clone(raw.profileSnapshot),
            tripSnapshot: clone(raw.tripSnapshot),
            fingerprint: key,
            reviewedAt: raw.reviewedAt,
            createdAt: raw.createdAt,
            state: "queued",
            events: [],
          };
          for (const event of raw.events)
            restored = reduceAttempt(restored, event);
          if (restored.state !== raw.state)
            throw new Error("Status cadangan tidak cocok dengan jurnal.");
          if (existing) {
            if (
              existing.id !== raw.id ||
              JSON.stringify(existing.profileSnapshot) !==
                JSON.stringify(raw.profileSnapshot) ||
              JSON.stringify(existing.tripSnapshot) !==
                JSON.stringify(raw.tripSnapshot)
            ) {
              await store.put(retainIncomingClick(existing, restored));
              continue;
            }
            let merged = existing;
            const incomingIds = new Set(raw.events.map((event) => event.id));
            const common = existing.events.filter(
              (event) =>
                !(
                  (event.generatedBy === "restore" ||
                    event.type === "restore_continuation") &&
                  !incomingIds.has(event.id)
                ),
            );
            const tail = existing.events.at(-1);
            const prefix = Math.min(common.length, raw.events.length);
            if (
              common
                .slice(0, prefix)
                .some(
                  (event, index) =>
                    event.id !== raw.events[index].id ||
                    JSON.stringify(event) !== JSON.stringify(raw.events[index]),
                )
            ) {
              await store.put(retainIncomingClick(existing, restored));
              continue;
            }
            if (raw.events.length > common.length) {
              if (
                tail?.generatedBy === "restore" &&
                common.length !== existing.events.length &&
                existing.state === "blocked"
              )
                merged = reduceAttempt(merged, {
                  id: crypto.randomUUID(),
                  attemptId: existing.id,
                  type: "restore_continuation",
                  at: new Date().toISOString(),
                  restoreState: tail.recoveryFromState,
                });
              for (const event of raw.events.slice(common.length))
                merged = reduceAttempt(merged, event);
            }
            await store.put(normalizeRestored(merged));
            continue;
          }
          await store.add(normalizeRestored(restored));
          count.submissions++;
        }
        await tx.done;
        return count;
      } catch (error) {
        tx.abort();
        await tx.done.catch(() => {});
        throw error;
      }
    },
    async clearAll() {
      const db = await database;
      const tx = db.transaction(["profiles", "submissions"], "readwrite");
      await tx.objectStore("profiles").clear();
      await tx.objectStore("submissions").clear();
      await tx.done;
    },
  };
}
