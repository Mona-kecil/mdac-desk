<script>
  import { validateProfile } from '../domain/validate.js';
  export let profiles = [], selected = [], busy = false;
  export let openProfile, openImport, toggleSelected, next, deleteProfile;
  $: passengers = profiles.filter(profile => selected.includes(profile.id));
</script>
<div class="eyebrow">Langkah 1 dari 3</div>
<h1>Siapa yang berangkat?</h1>
<p>Tambahkan penumpang. Foto paspor dibaca di perangkat ini.</p>
<div class="entry-choices">
  <button onclick={() => openImport('photo')} disabled={busy}><strong>Foto paspor</strong><span>Baca foto, lalu tinjau hasilnya</span></button>
  <button onclick={() => openImport('spreadsheet')} disabled={busy}><strong>Excel / CSV</strong><span>Impor dan periksa setiap baris</span></button>
  <button onclick={() => openProfile()} disabled={busy}><strong>Isi manual</strong><span>Masukkan data sesuai paspor</span></button>
</div>
<h2>Penumpang perjalanan ini <small>({passengers.length})</small></h2>
<div class="passenger-list">
  {#each passengers as item}
    <article class="passenger-row"><div><strong>{item.name || 'Tanpa nama'}</strong><small>Paspor berakhir {item.passportNo.slice(-4)} · {item.email}</small>{#if !item.reviewedAt || validateProfile(item).length}<small class="error-text">Lengkapi dan tinjau profil sebelum melanjutkan.</small>{/if}</div><div class="row-actions"><button onclick={() => openProfile(item)}>Tinjau</button><button class="ghost" aria-label={`Keluarkan ${item.name} dari perjalanan`} onclick={() => toggleSelected(item.id)}>×</button></div></article>
  {:else}<div class="empty-note">Belum ada penumpang. Pilih cara menambah data di atas.</div>{/each}
</div>
{#if profiles.length}<details class="saved-profiles"><summary>Pilih dari {profiles.length} profil tersimpan</summary>{#each profiles as item}<div class="saved-profile"><label class="check-label"><input type="checkbox" checked={selected.includes(item.id)} onchange={() => toggleSelected(item.id)} /><span>{item.name || 'Draf tanpa nama'}<small>Paspor berakhir {item.passportNo.slice(-4)}</small></span></label><button class="ghost" onclick={() => openProfile(item)}>Edit</button><button class="ghost" aria-label={`Hapus profil ${item.name}`} onclick={() => deleteProfile(item)}>Hapus</button></div>{/each}</details>{/if}
<div class="wizard-actions"><small>Profil dan riwayat tersimpan di browser ini.</small><button class="primary" onclick={next} disabled={busy || !passengers.length || passengers.some(item => !item.reviewedAt || validateProfile(item).length)}>Lanjut ke perjalanan →</button></div>
