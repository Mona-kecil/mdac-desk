<script>
  import RecordFields from './RecordFields.svelte';
  export let trip, range, count, back, next, busy = false;
</script>
<div class="eyebrow">Langkah 2 dari 3</div><h1>Kapan dan ke mana?</h1><p>Detail perjalanan ini dipakai untuk {count} penumpang.</p>
<div class="notice">Tanggal tiba {range.min} sampai {range.max}, mengikuti waktu Malaysia. Setiap penumpang menyelesaikan puzzle sendiri.</div>
<RecordFields kind="trip" bind:value={trip} minArrival={range.min} maxArrival={range.max} />
<div class="wizard-actions"><button onclick={back}>← Penumpang</button><button class="primary" onclick={next} disabled={busy}>Tinjau pengajuan →</button></div>
