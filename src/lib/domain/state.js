const transitions = {
  queued: { filling: "filling", cancelled: "cancelled", blocked: "blocked" },
  filling: {
    awaiting_verification: "awaiting_verification",
    blocked: "blocked",
    cancelled: "cancelled",
  },
  awaiting_verification: {
    click_intent: "submitting",
    blocked: "blocked",
    cancelled: "cancelled",
  },
  submitting: { outcome_unknown: "outcome_unknown", reconcile: "confirmed" },
  outcome_unknown: {
    reconcile: "confirmed",
    outcome_unknown: "outcome_unknown",
  },
  blocked: { retry: "queued", cancelled: "cancelled" },
  cancelled: { retry: "queued" },
  confirmed: {},
};
export const isInstant = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() ===
    (value.includes(".") ? value : value.replace("Z", ".000Z"));
export function reduceAttempt(submission, event) {
  if (
    !event ||
    typeof event.id !== "string" ||
    !event.id ||
    event.id.length > 100 ||
    event.attemptId !== submission.id ||
    !isInstant(event.at)
  )
    throw new Error("Peristiwa pengiriman tidak valid.");
  if (
    (event.detail != null &&
      (typeof event.detail !== "string" || event.detail.length > 1000)) ||
    (event.reference != null &&
      (typeof event.reference !== "string" || event.reference.length > 200))
  )
    throw new Error("Bukti peristiwa tidak valid.");
  const previous = submission.events.find((entry) => entry.id === event.id);
  if (previous) {
    if (JSON.stringify(previous) !== JSON.stringify(event))
      throw new Error("ID peristiwa dipakai untuk bukti yang berbeda.");
    return submission;
  }
  if (
    event.type === "retry" &&
    (submission.submittedAt ||
      submission.events.some((previous) => previous.type === "click_intent"))
  )
    throw new Error("Hasil klik harus direkonsiliasi, bukan dicoba ulang.");
  const recovery = submission.events.at(-1);
  const restoresInterruptedState =
    event.type === "restore_continuation" &&
    submission.state === "blocked" &&
    recovery?.generatedBy === "restore" &&
    ["filling", "awaiting_verification"].includes(recovery.recoveryFromState) &&
    event.restoreState === recovery.recoveryFromState;
  const hasConflictingClick =
    event.type === "backup_conflict" &&
    isInstant(event.conflictClickAt) &&
    typeof event.conflictSourceEventId === "string";
  const next = hasConflictingClick
    ? submission.state === "confirmed"
      ? "confirmed"
      : "outcome_unknown"
    : restoresInterruptedState
      ? event.restoreState
      : transitions[submission.state]?.[event.type];
  if (!next)
    throw new Error(
      `Perubahan status ${submission.state} → ${event.type} ditolak.`,
    );
  if (
    event.type === "reconcile" &&
    (typeof event.reference !== "string" || !event.reference.trim())
  )
    throw new Error("Nomor referensi pengakuan wajib diisi.");
  const result = {
    ...submission,
    state: next,
    events: [...submission.events, structuredClone(event)],
  };
  if (event.type === "click_intent") result.submittedAt = event.at;
  if (hasConflictingClick && !result.submittedAt)
    result.submittedAt = event.conflictClickAt;
  if (event.type === "reconcile") {
    result.confirmedAt = event.at;
    result.receipt = {
      reference: event.reference.trim(),
      source: "user-confirmed",
      at: event.at,
    };
  }
  return result;
}
