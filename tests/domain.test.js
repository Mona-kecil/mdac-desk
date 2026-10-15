import { describe, it, expect } from "vitest";
import {
  arrivalRange,
  malaysiaToday,
  isISODate,
  validateProfile,
  validateTrip,
} from "../src/lib/domain/validate.js";
import { reduceAttempt } from "../src/lib/domain/state.js";
import { parseMRZ, checkDigit } from "../src/lib/import/mrz.js";
const event = (type, extra = {}) => ({
  id: crypto.randomUUID(),
  attemptId: "attempt",
  type,
  at: "2026-10-15T10:00:00Z",
  ...extra,
});
describe("Malaysian calendar boundaries", () => {
  it("switches days at Malaysian midnight across a year", () => {
    expect(malaysiaToday(new Date("2026-12-31T15:59:59Z"))).toBe("2026-12-31");
    expect(arrivalRange(new Date("2026-12-31T16:00:00Z"))).toEqual({
      min: "2027-01-01",
      max: "2027-01-03",
    });
  });
  it("rejects rollover and ambiguous dates", () => {
    expect(isISODate("2026-02-29")).toBe(false);
    expect(isISODate("2024-02-29")).toBe(true);
    expect(isISODate("01/02/2026")).toBe(false);
  });
  it("requires true birthplace and independent contact data", () => {
    expect(
      validateProfile(
        {
          name: "A",
          passportNo: "00123",
          birthDate: "2000-01-01",
          nationality: "IDN",
          sex: "1",
          passportExpiry: "2030-01-01",
          email: "a@example.com",
          phoneCountry: "62",
          phone: "00123456",
        },
        new Date("2026-10-15"),
      ),
    ).toContain("Negara kelahiran wajib diisi.");
    expect(
      validateTrip({ arrival: "2026-10-18" }, new Date("2026-10-15T00:00:00Z")),
    ).toContain(
      "Tanggal tiba harus 2026-10-15 sampai 2026-10-17 (waktu Malaysia).",
    );
  });
});
describe("submission evidence", () => {
  it("requires verification before click and receipt reference before confirmation", () => {
    const queued = { id: "attempt", state: "queued", events: [] };
    expect(() => reduceAttempt(queued, event("click_intent"))).toThrow();
    let record = reduceAttempt(queued, event("filling"));
    record = reduceAttempt(record, event("awaiting_verification"));
    record = reduceAttempt(record, event("click_intent"));
    expect(record.state).toBe("submitting");
    expect(record.confirmedAt).toBeUndefined();
    record = reduceAttempt(record, event("outcome_unknown"));
    expect(() => reduceAttempt(record, event("retry"))).toThrow();
    expect(() =>
      reduceAttempt(record, event("reconcile", { reference: "" })),
    ).toThrow();
    const confirmation = event("reconcile", { reference: "ACK-123" });
    record = reduceAttempt(record, confirmation);
    expect(record.receipt).toEqual({
      reference: "ACK-123",
      source: "user-confirmed",
      at: confirmation.at,
    });
    expect(reduceAttempt(record, confirmation).events).toHaveLength(5);
    expect(queued.events).toEqual([]);
  });
  it("permits explicit before-click retries only", () => {
    const blocked = reduceAttempt(
      { id: "attempt", state: "queued", events: [] },
      event("blocked"),
    );
    expect(reduceAttempt(blocked, event("retry")).state).toBe("queued");
  });
});
describe("TD3 MRZ", () => {
  const sample =
    "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10";
  it("reads known ICAO fields and verifies checksums without inventing birthplace", () => {
    const result = parseMRZ(sample, new Date("2011-01-01"));
    expect(result.profile).toEqual({
      name: "ERIKSSON ANNA MARIA",
      passportNo: "L898902C3",
      nationality: "UTO",
      birthDate: "1974-08-12",
      passportExpiry: "2012-04-15",
      sex: "2",
    });
    expect(result.issues.filter((issue) => issue.includes("Checksum"))).toEqual(
      [],
    );
    expect(result.profile.birthPlace).toBeUndefined();
    expect(checkDigit("L898902C3")).toBe("6");
  });
  it("retains draft plus checksum errors when OCR changes a character", () => {
    const result = parseMRZ(sample.replace("L898902C3", "L898902C4"));
    expect(result.profile.passportNo).toBe("L898902C4");
    expect(
      result.issues.some((issue) => issue.includes("Checksum nomor paspor")),
    ).toBe(true);
  });
});

it("rejects a reused event ID with different evidence", () => {
  const initial = { id: "attempt", state: "queued", events: [] };
  const first = event("filling");
  const record = reduceAttempt(initial, first);
  expect(() => reduceAttempt(record, { ...first, type: "blocked" })).toThrow(
    "bukti yang berbeda",
  );
});
