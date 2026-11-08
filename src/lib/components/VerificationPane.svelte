<script>
  import SliderPuzzle from './SliderPuzzle.svelte';
  let { phase, replay, cancel, reconnect, reconcile, checkUrl } = $props();
  const puzzle = $derived(phase.kind === 'verification' ? phase.puzzle : null);
  const status = $derived(phase.verification === 'verified' ? 'Verifikasi lolos. Mengirim pengajuan.' : phase.verification === 'failed' ? 'Belum pas. Memuat puzzle baru.' : phase.verification === 'checking' ? 'Memeriksa di portal resmi.' : puzzle ? '' : 'Memuat puzzle.');
</script>
<h1>{phase.kind === 'verification' ? 'Selesaikan puzzle resmi' : phase.kind === 'paused' ? 'Periksa hasil pengajuan' : 'Menyiapkan formulir resmi'}</h1>
<p><strong>{phase.attempt?.profileSnapshot.name}</strong> · {phase.attempt?.profileSnapshot.passportNo}</p>
{#if phase.kind === 'verification'}
  <p>Pengajuan dikirim satu kali setelah verifikasi lolos.</p>
  <div class="verification-frame">
    {#if puzzle}{#key puzzle.id}<SliderPuzzle {puzzle} disabled={phase.verification !== 'ready'} onrelease={path => replay(puzzle.id, path)} />{/key}{/if}
  </div>
  <p class="verification-status" role="status">{status}</p>
{/if}
{#if phase.kind === 'connecting'}<div class="notice">Formulir sedang disiapkan. Data dan niat kirim tetap terikat pada pengajuan ini saat halaman dimuat ulang.</div>{/if}
{#if ['outcome_unknown', 'submitting'].includes(phase.attempt?.state)}<div class="notice warning">Belum ada bukti penerimaan yang tercatat. Rombongan dijeda. Jangan kirim ulang sebelum memeriksa hasil di portal resmi.</div><div class="wizard-actions"><a class="button" href={checkUrl} target="_blank" rel="noreferrer">Check Registration ↗</a><button class="primary" onclick={() => reconcile(phase.attempt)}>Catat referensi setelah diperiksa</button></div>{:else if phase.kind === 'paused'}<div class="notice">Sesi dihentikan sebelum niat kirim tercatat. Periksa riwayat untuk mencoba ulang.</div>{/if}
{#if phase.error}<p class="error-text" role="alert">{phase.error}</p><button onclick={reconnect}>Sambungkan kembali sesi</button>{/if}
{#if phase.kind !== 'paused'}<div class="wizard-actions"><button onclick={() => cancel()}>Hentikan pengiriman</button><small>Sesi berakhir setelah 3 menit tanpa interaksi atau paling lama 15 menit.</small></div>{/if}
