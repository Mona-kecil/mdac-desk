<script>
  import { PROFILE_FIELDS, TRIP_FIELDS } from '../domain/schema.js';
  export let profiles, trip, labels, displayValue, back, send, busy = false, blocked = false;
  let consent = false;
</script>
<div class="eyebrow">Langkah 3 dari 3</div><h1>Periksa sebelum dikirim</h1><p>Cocokkan nama, paspor, dan kontak setiap penumpang.</p>
{#each profiles as profile}<details class="review-person" open><summary>{profile.name} · {profile.passportNo}</summary><dl class="snapshot-list">{#each PROFILE_FIELDS as key}<div><dt>{labels[key]}</dt><dd>{displayValue(key, profile[key], profile)}</dd></div>{/each}</dl></details>{/each}
<h2>Perjalanan bersama</h2><dl class="snapshot-list">{#each TRIP_FIELDS as key}<div><dt>{labels[key]}</dt><dd>{displayValue(key, trip[key], trip)}</dd></div>{/each}</dl>
<div class="notice">Saat Anda memilih Kirim, data teks terpilih diproses dalam sesi sementara hingga 15 menit. Foto paspor tidak dikirim. Setelah puzzle resmi selesai, pengajuan dikirim satu kali. Anda tidak perlu menekan Kirim lagi.</div>
<label class="check-label top-spaced"><input type="checkbox" bind:checked={consent} /><span>Saya telah memeriksa seluruh data dan mengizinkan pengiriman untuk {profiles.length} penumpang.</span></label>
{#if blocked}<p class="error-text">Periksa pengajuan yang aktif atau hasilnya belum diketahui sebelum mengirim lagi.</p>{/if}
<div class="wizard-actions"><button onclick={back} disabled={busy}>← Ubah perjalanan</button><button class="primary" onclick={send} disabled={busy || !consent || blocked}>Kirim {profiles.length} pengajuan →</button></div>
