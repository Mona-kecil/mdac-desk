import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { createRepository } from "../src/lib/storage/repository.js";
import { malaysiaToday } from "../src/lib/domain/validate.js";
const profile = {
  name: "TEST PERSON",
  passportNo: "00123456",
  birthDate: "2000-01-01",
  nationality: "IDN",
  birthPlace: "IDN",
  sex: "1",
  passportExpiry: "2035-01-01",
  email: "test@example.com",
  phoneCountry: "62",
  phone: "0012345678",
  reviewedAt: new Date().toISOString(),
};
const trip = {
  arrival: malaysiaToday(),
  departure: malaysiaToday(),
  transportNo: "TEST123",
  travelMode: "1",
  embarkation: "IDN",
  accommodationKind: "01",
  address1: "ONE TEST ROAD",
  address2: "",
  state: "14",
  city: "1400",
  postcode: "00100",
};
const repo = () => createRepository(crypto.randomUUID());
describe("browser record ownership", () => {
  it("deduplicates profile imports across repository instances", async () => {
    const name = crypto.randomUUID();
    const a = createRepository(name);
    const b = createRepository(name);
    await Promise.all([a.saveProfile(profile), b.saveProfile(profile)]);
    expect(await a.listProfiles()).toHaveLength(1);
    expect((await a.listProfiles())[0].passportNo).toBe("00123456");
  });
  it("queues immutable snapshots and rejects duplicate trip attempts across tabs", async () => {
    const name = crypto.randomUUID();
    const a = createRepository(name);
    const b = createRepository(name);
    const saved = await a.saveProfile(profile);
    const results = await Promise.allSettled([
      a.queue([saved], trip),
      b.queue([saved], trip),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    await a.saveProfile({ ...saved, name: "CHANGED NAME" });
    const [submission] = await a.listSubmissions();
    expect(submission.profileSnapshot.name).toBe("TEST PERSON");
    expect(submission.tripSnapshot.postcode).toBe("00100");
    expect(submission.state).toBe("queued");
  });
  it("merges backups idempotently and records event evidence once", async () => {
    const source = repo();
    const target = repo();
    const saved = await source.saveProfile(profile);
    const [submission] = await source.queue([saved], trip);
    const e = {
      id: "fill-event",
      attemptId: submission.id,
      type: "filling",
      at: new Date().toISOString(),
    };
    await source.appendEvent(submission.id, e);
    await source.appendEvent(submission.id, e);
    expect((await source.listSubmissions())[0].events).toHaveLength(1);
    const backup = await source.exportBackup();
    expect(await target.restoreBackup(backup)).toEqual({
      profiles: 1,
      submissions: 1,
    });
    expect(await target.restoreBackup(backup)).toEqual({
      profiles: 0,
      submissions: 0,
    });
    expect((await target.listSubmissions())[0].state).toBe("blocked");
  });
  it("rolls back a malformed backup and refuses draft queueing", async () => {
    const store = repo();
    const saved = await store.saveProfile({ ...profile, reviewedAt: null });
    await expect(store.queue([saved], trip)).rejects.toThrow(
      "belum lengkap dan ditinjau",
    );
    const backup = await store.exportBackup();
    backup.submissions = [{ id: "broken" }];
    const target = repo();
    await expect(target.restoreBackup(backup)).rejects.toThrow();
    expect(await target.listProfiles()).toEqual([]);
  });
});

describe("successive backup recovery", () => {
  it("normalizes merged work and retains later click evidence after an interrupted restore", async () => {
    const source = repo();
    const target = repo();
    const saved = await source.saveProfile(profile);
    const [submission] = await source.queue([saved], trip);
    const event = (type) => ({
      id: crypto.randomUUID(),
      attemptId: submission.id,
      type,
      at: new Date().toISOString(),
    });
    await target.restoreBackup(await source.exportBackup());
    await source.appendEvent(submission.id, event("filling"));
    await target.restoreBackup(await source.exportBackup());
    expect((await target.listSubmissions())[0].state).toBe("blocked");
    await source.appendEvent(submission.id, event("awaiting_verification"));
    await source.appendEvent(submission.id, event("click_intent"));
    const clicked = await source.exportBackup();
    await target.restoreBackup(clicked);
    const unknown = (await target.listSubmissions())[0];
    expect(unknown.state).toBe("outcome_unknown");
    expect(unknown.events.some((e) => e.type === "click_intent")).toBe(true);
    await expect(
      target.appendEvent(submission.id, event("retry")),
    ).rejects.toThrow();
    await target.restoreBackup(clicked);
    expect((await target.listSubmissions())[0].events).toHaveLength(
      unknown.events.length,
    );
    await source.appendEvent(submission.id, {
      ...event("reconcile"),
      reference: "ACK-456",
    });
    await target.restoreBackup(await source.exportBackup());
    expect((await target.listSubmissions())[0].receipt.reference).toBe(
      "ACK-456",
    );
  });
  it("rejects numeric timestamps as a whole transaction", async () => {
    const source = repo();
    await source.saveProfile(profile);
    const backup = await source.exportBackup();
    backup.profiles[0].updatedAt = 123;
    const target = repo();
    await expect(target.restoreBackup(backup)).rejects.toThrow(
      "Profil cadangan",
    );
    expect(await target.listProfiles()).toEqual([]);
  });
  it("keeps existing contact data when another import shares an identity", async () => {
    const store = repo();
    const original = await store.saveProfile(profile);
    await store.saveProfile({
      passportNo: profile.passportNo,
      nationality: profile.nationality,
      name: "OTHER NAME",
    });
    expect(await store.listProfiles()).toEqual([original]);
  });
});

it("holds a divergent backup click as evidence instead of permitting retry", async () => {
  const source = repo();
  const target = repo();
  const saved = await source.saveProfile(profile);
  const [submission] = await source.queue([saved], trip);
  const event = (type) => ({
    id: crypto.randomUUID(),
    attemptId: submission.id,
    type,
    at: new Date().toISOString(),
  });
  await source.appendEvent(submission.id, event("filling"));
  await target.restoreBackup(await source.exportBackup());
  await target.appendEvent(submission.id, event("retry"));
  await source.appendEvent(submission.id, event("awaiting_verification"));
  await source.appendEvent(submission.id, event("click_intent"));
  await target.restoreBackup(await source.exportBackup());
  const record = (await target.listSubmissions())[0];
  expect(record.state).toBe("outcome_unknown");
  expect(record.events.at(-1).type).toBe("backup_conflict");
  await expect(
    target.appendEvent(submission.id, event("retry")),
  ).rejects.toThrow();
});

it("rejects snapshot objects in string fields without losing existing data", async () => {
  const source = repo();
  const saved = await source.saveProfile(profile);
  await source.queue([saved], trip);
  const backup = await source.exportBackup();
  backup.submissions[0].profileSnapshot.phone = { number: "123" };
  const target = repo();
  await expect(target.restoreBackup(backup)).rejects.toThrow("Snapshot");
  expect(await target.listProfiles()).toEqual([]);
});

it("blocks a queued identity when a different submission ID has click evidence", async () => {
  const a = repo();
  const b = repo();
  const pa = await a.saveProfile(profile);
  const pb = await b.saveProfile(profile);
  const [sa] = await a.queue([pa], trip);
  const [sb] = await b.queue([pb], { ...trip, address1: "ANOTHER TEST ROAD" });
  for (const type of ["filling", "awaiting_verification", "click_intent"])
    await b.appendEvent(sb.id, {
      id: crypto.randomUUID(),
      attemptId: sb.id,
      type,
      at: new Date().toISOString(),
    });
  const backup = await b.exportBackup();
  await a.restoreBackup(backup);
  const record = (await a.listSubmissions())[0];
  expect(record.id).toBe(sa.id);
  expect(record.state).toBe("outcome_unknown");
  expect(record.events.at(-1).sourceAttemptId).toBe(sb.id);
  await expect(
    a.appendEvent(sa.id, {
      id: crypto.randomUUID(),
      attemptId: sa.id,
      type: "retry",
      at: new Date().toISOString(),
    }),
  ).rejects.toThrow();
  await a.restoreBackup(backup);
  expect((await a.listSubmissions())[0].events).toHaveLength(
    record.events.length,
  );
});
