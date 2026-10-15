<script>
  export let phase, input, cancel, reconnect, reconcile, checkUrl;
  let pointer = null, lastMove = 0, pointerGeneration;
  $: if (pointerGeneration !== phase.frame?.generation) { pointer = null; pointerGeneration = phase.frame?.generation; }
  function relay(event, type) {
    if (!event.isTrusted || !phase.frame || phase.kind !== 'verification') return;
    if (type === 'down') { if (pointer !== null) return; pointer = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); }
    if (event.pointerId !== pointer) return;
    if (type === 'move' && performance.now() - lastMove < 60) return;
    lastMove = performance.now();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(phase.frame.width, (event.clientX - rect.left) * phase.frame.width / rect.width));
    const y = Math.max(0, Math.min(phase.frame.height, (event.clientY - rect.top) * phase.frame.height / rect.height));
    void input(type, x, y, phase.frame.generation);
    if (type === 'up') pointer = null;
  }
</script>
<div class="eyebrow">Pengiriman</div><h1>{phase.kind === 'verification' ? 'Selesaikan puzzle resmi' : phase.kind === 'paused' ? 'Periksa hasil pengajuan' : 'Menyiapkan formulir resmi'}</h1>
<p><strong>{phase.attempt?.profileSnapshot.name}</strong> · {phase.attempt?.profileSnapshot.passportNo}</p>
{#if phase.kind === 'verification'}<p>Geser puzzle dari portal MDAC di bawah. Pengajuan dikirim satu kali setelah verifikasi lolos.</p>{/if}
{#if phase.frame}<div class="verification-frame"><img src={phase.frame.image} alt="Tampilan verifikasi dari portal MDAC" draggable="false" style={`max-width:${phase.frame.width}px`} onpointerdown={event => relay(event, 'down')} onpointermove={event => relay(event, 'move')} onpointerup={event => relay(event, 'up')} onpointercancel={() => { pointer = null; void cancel(); }} /></div>{/if}
{#if phase.kind === 'connecting'}<div class="notice">Formulir sedang disiapkan. Data dan niat kirim tetap terikat pada pengajuan ini saat halaman dimuat ulang.</div>{/if}
{#if ['outcome_unknown', 'submitting'].includes(phase.attempt?.state)}<div class="notice warning">Belum ada bukti penerimaan yang tercatat. Rombongan dijeda. Jangan kirim ulang sebelum memeriksa hasil di portal resmi.</div><div class="wizard-actions"><a class="button" href={checkUrl} target="_blank" rel="noreferrer">Check Registration ↗</a><button class="primary" onclick={() => reconcile(phase.attempt)}>Catat referensi setelah diperiksa</button></div>{:else if phase.kind === 'paused'}<div class="notice">Sesi dihentikan sebelum niat kirim tercatat. Periksa riwayat untuk mencoba ulang.</div>{/if}
{#if phase.error}<p class="error-text" role="alert">{phase.error}</p><button onclick={reconnect}>Sambungkan kembali sesi</button>{/if}
{#if phase.kind !== 'paused'}<div class="wizard-actions"><button onclick={() => cancel()}>Hentikan pengiriman</button><small>Sesi berakhir setelah 3 menit tanpa interaksi atau paling lama 15 menit.</small></div>{/if}
