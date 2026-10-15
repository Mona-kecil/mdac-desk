const transitions = {
  queued: {filling:'filling',cancelled:'cancelled',blocked:'blocked'},
  filling: {awaiting_verification:'awaiting_verification',blocked:'blocked',cancelled:'cancelled'},
  awaiting_verification: {click_intent:'submitting',blocked:'blocked',cancelled:'cancelled'},
  submitting: {outcome_unknown:'outcome_unknown',reconcile:'confirmed'},
  outcome_unknown: {reconcile:'confirmed'},
  blocked: {retry:'queued',cancelled:'cancelled'},
  cancelled: {retry:'queued'}, confirmed: {}
};
export function reduceAttempt(submission, event) {
  if (!event || typeof event.id !== 'string' || event.attemptId !== submission.id || !Number.isFinite(Date.parse(event.at))) throw new Error('Peristiwa pengiriman tidak valid.');
  if (submission.events.some(previous => previous.id === event.id)) return submission;
  if (event.type === 'retry' && (submission.submittedAt || submission.events.some(previous => previous.type === 'click_intent'))) throw new Error('Hasil klik harus direkonsiliasi, bukan dicoba ulang.');
  const next = transitions[submission.state]?.[event.type];
  if (!next) throw new Error(`Perubahan status ${submission.state} → ${event.type} ditolak.`);
  if (event.type === 'reconcile' && (typeof event.reference !== 'string' || !event.reference.trim())) throw new Error('Nomor referensi pengakuan wajib diisi.');
  const result = {...submission, state:next, events:[...submission.events, structuredClone(event)]};
  if (event.type === 'click_intent') result.submittedAt = event.at;
  if (event.type === 'reconcile') {
    result.confirmedAt = event.at;
    result.receipt = {reference:event.reference.trim(),source:'user-confirmed',at:event.at};
  }
  return result;
}
