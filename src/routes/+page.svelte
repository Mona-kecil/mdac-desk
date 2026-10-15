<script>
  import { onMount } from 'svelte';
  import '../app.css';
  import PassengerStep from '#lib/components/PassengerStep.svelte';
  import TripStep from '#lib/components/TripStep.svelte';
  import ReviewStep from '#lib/components/ReviewStep.svelte';
  import VerificationPane from '#lib/components/VerificationPane.svelte';
  import ProfileDialog from '#lib/components/ProfileDialog.svelte';
  import { emptyTrip, options, cities, PROFILE_FIELDS, TRIP_FIELDS, stateLabels, OFFICIAL_URL, CHECK_URL } from '#lib/domain/schema.js';
  import { validateTrip, arrivalRange } from '#lib/domain/validate.js';
  import { createRepository } from '#lib/storage/repository.js';
  import { createSubmissionDesk } from '#lib/submission/desk.js';
  const labels = { name:'Nama lengkap',passportNo:'Nomor paspor',birthDate:'Tanggal lahir',nationality:'Kewarganegaraan',birthPlace:'Negara kelahiran',sex:'Jenis kelamin',passportExpiry:'Berlaku hingga',email:'Email',phoneCountry:'Kode telepon',phone:'Telepon',arrival:'Tiba di Malaysia',departure:'Meninggalkan Malaysia',transportNo:'Penerbangan / kendaraan',travelMode:'Moda perjalanan',embarkation:'Negara keberangkatan',accommodationKind:'Penginapan',address1:'Alamat penginapan',address2:'Alamat tambahan',state:'Negeri / wilayah',city:'Kota',postcode:'Kode pos' };
  const optionKeys = {nationality:'nationality',birthPlace:'nationality',phoneCountry:'region',sex:'sex',travelMode:'trvlMode',embarkation:'nationality',accommodationKind:'accommodationStay',state:'accommodationState'};
  let repository, desk, profiles = [], submissions = [], selected = [], trip = emptyTrip();
  let screen = 'wizard', step = 0, phase = {kind:'idle'}, loading = true, busy = false;
  let errors = [], toast = '', modal = null, reviewReference = '', reconciliationReviewed = false;
  let restoreInput, persistent = null, clearText = '', range = {min:'',max:''};
  $: selectedProfiles = profiles.filter(item => selected.includes(item.id));
  $: blocked = submissions.some(item => ['filling','awaiting_verification','submitting','outcome_unknown'].includes(item.state));
  async function refresh() {
    if (!repository) return;
    [profiles,submissions] = await Promise.all([repository.listProfiles(),repository.listSubmissions()]);
    selected = selected.filter(id => profiles.some(item => item.id === id));
    range = arrivalRange();
  }
  async function run(action) {
    busy = true; errors = [];
    try { await action(); } catch(error) { errors = [error.message || 'Tindakan gagal. Periksa data.']; }
    finally { busy = false; }
  }
  onMount(() => {
    repository = createRepository();
    desk = createSubmissionDesk({repository,changed:async next => { phase = next; await refresh(); }});
    void run(async () => { await refresh(); await desk.initialize(); if(phase.kind !== 'idle') screen = 'submission'; persistent = await navigator.storage?.persisted?.() ?? null; }).finally(() => {loading = false;});
    const reload = () => { void refresh(); };
    window.addEventListener('focus',reload);
    return () => { window.removeEventListener('focus',reload); desk.dispose(); };
  });
  function displayValue(key,value,snapshot={}) {
    if (!value) return 'Belum diisi';
    if(key === 'city') return cities[snapshot.state]?.find(item => item.value === value)?.label || value;
    return options[optionKeys[key]]?.find(item => item.value === value)?.label || value;
  }
  const dateTime = value => value ? new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : 'Belum tercatat';
  function toggleSelected(id) { selected = selected.includes(id) ? selected.filter(item => item !== id) : [...selected,id]; }
  function openProfile(initial=null) { modal = {kind:'profile',initial,mode:'manual'}; }
  function openImport(mode) { modal = {kind:'profile',initial:null,mode}; }
  async function saved(ids=[]) { await refresh(); selected = [...new Set([...selected,...ids])]; }
  function nextTrip() { step = 1; errors = []; }
  function nextReview() { errors = validateTrip(trip); if(!errors.length) step = 2; }
  async function send() {
    await run(async () => {
      const records = await repository.queue(selectedProfiles,trip);
      await refresh(); selected = []; screen = 'submission';
      await desk.start(records[0]);
    });
  }
  async function start(item) { screen='submission'; await run(() => desk.start(item)); }
  async function cancel(item) { await run(async () => { await desk.cancel(item); await refresh(); }); }
  async function retry(item) { screen='submission'; await run(() => desk.retry(item)); }
  function openReconcile(item) { reviewReference='';reconciliationReviewed=false;modal={kind:'reconcile',item}; }
  async function reconcile() {
    if(!reviewReference.trim() || !reconciliationReviewed) return;
    await run(async () => { await repository.appendEvent(modal.item.id,{id:crypto.randomUUID(),attemptId:modal.item.id,type:'reconcile',at:new Date().toISOString(),reference:reviewReference.trim(),detail:'Pengguna memeriksa pendaftaran pada halaman Check Registration MDAC.'});modal=null;await refresh();screen='history'; });
  }
  function download(name,contents,type) {const url=URL.createObjectURL(new Blob([contents],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function restore(event) {
    const file=event.currentTarget.files?.[0];if(!file)return;
    await run(async()=>{if(file.size>32*1024*1024)throw Error('Cadangan maksimal 32 MB.');const result=await repository.restoreBackup(JSON.parse(await file.text()));await desk.initialize();await refresh();toast=`Cadangan digabung. ${result.profiles} profil dan ${result.submissions} pengiriman diproses.`;});event.target.value='';
  }
  async function remove() {
    await run(async()=>{if(modal.kind==='clear'){if(clearText!=='HAPUS')return;await repository.clearAll();selected=[];}else if(modal.kind==='deleteProfile')await repository.deleteProfile(modal.item.id);else await repository.deleteSubmission(modal.item.id);modal=null;await refresh();});
  }
</script>
<svelte:head><title>MDAC Desk · Siapkan perjalanan</title><meta name="description" content="Siapkan penumpang, tinjau satu perjalanan bersama, dan selesaikan verifikasi MDAC. OCR foto paspor berjalan di perangkat Anda." /></svelte:head>
<header class="wizard-top"><div><button class="wordmark" onclick={()=>{screen='wizard';step=0;}}>MDAC Desk<span>.</span></button><nav aria-label="Menu"><button class="ghost" onclick={()=>screen='history'}>Riwayat</button><button class="ghost" onclick={()=>screen='data'}>Data & bantuan</button></nav></div></header>
<main class="wizard-wrap">
  {#if loading}<section class="wizard-panel"><p role="status">Membuka data di perangkat ini…</p></section>{:else}
  {#if screen === 'wizard'}<nav class="wizard-steps" aria-label="Tahapan">{#each ['Penumpang','Perjalanan','Tinjau & kirim'] as name,index}<div class:active={step===index} class:done={step>index}><b>{index+1}</b><span>{name}</span></div>{/each}</nav>{/if}
  {#if errors.length}<div class="errors" role="alert"><ul>{#each errors as error}<li>{error}</li>{/each}</ul></div>{/if}
  {#if toast}<div class="notice" role="status">{toast}<button class="ghost" aria-label="Tutup pemberitahuan" onclick={()=>toast=''}>×</button></div>{/if}
  <section class="wizard-panel">
  {#if screen === 'wizard'}
    {#if step===0}<PassengerStep {profiles} {selected} {busy} {openProfile} {openImport} {toggleSelected} next={nextTrip} deleteProfile={item=>modal={kind:'deleteProfile',item}} />
    {:else if step===1}<TripStep bind:trip {range} count={selectedProfiles.length} {busy} back={()=>step=0} next={nextReview} />
    {:else}<ReviewStep profiles={selectedProfiles} {trip} {labels} {displayValue} {busy} {blocked} back={()=>step=1} {send} />{/if}
  {:else if screen === 'submission' && phase.kind !== 'idle'}
    <VerificationPane {phase} input={(...args)=>desk.input(...args)} cancel={()=>cancel()} reconnect={()=>run(()=>desk.reconnect())} reconcile={openReconcile} checkUrl={CHECK_URL} />
    <button class="text-link top-spaced" onclick={()=>screen='history'}>Lihat progres semua penumpang</button>
  {:else if screen === 'history' || screen === 'submission'}
    <div class="eyebrow">Tersimpan di perangkat ini</div><h1>Riwayat pengiriman</h1><p>Setiap catatan memakai salinan data saat Anda memilih Kirim.</p>
    {#each submissions as item}<article class="history-card"><div class="split"><h2>{item.profileSnapshot.name}</h2><span class="badge">{stateLabels[item.state]}</span></div><p>Paspor {item.profileSnapshot.passportNo} · Tiba {item.tripSnapshot.arrival}</p><small>{dateTime(item.createdAt)}</small>
    {#if item.state==='outcome_unknown' || item.state==='submitting'}<div class="notice warning">Hasil belum diketahui. Jangan kirim ulang sebelum memeriksa portal resmi.</div><a href={CHECK_URL} target="_blank" rel="noreferrer">Check Registration ↗</a><button class="primary" onclick={()=>openReconcile(item)}>Catat referensi</button>
    {:else if item.state==='queued'}<button class="primary" disabled={busy||blocked} onclick={()=>start(item)}>Lanjutkan pengajuan</button><button onclick={()=>cancel(item)} disabled={busy}>Batalkan</button>
    {:else if ['filling','awaiting_verification'].includes(item.state)}<button class="primary" onclick={()=>{screen='submission';void run(()=>desk.reconnect());}}>Buka verifikasi</button><button onclick={()=>cancel(item)}>Hentikan</button>
    {:else if ['blocked','cancelled'].includes(item.state) && item.transport==='web-v1' && !item.submittedAt}<button onclick={()=>retry(item)} disabled={busy||blocked}>Coba ulang pengajuan ini</button>{/if}
    {#if item.receipt}<p>Referensi {item.receipt.reference} · Dikonfirmasi pengguna {dateTime(item.confirmedAt)}</p>{/if}
    <details><summary>Data & bukti peristiwa</summary><dl class="snapshot-list">{#each PROFILE_FIELDS as key}<div><dt>{labels[key]}</dt><dd>{displayValue(key,item.profileSnapshot[key],item.profileSnapshot)}</dd></div>{/each}{#each TRIP_FIELDS as key}<div><dt>{labels[key]}</dt><dd>{displayValue(key,item.tripSnapshot[key],item.tripSnapshot)}</dd></div>{/each}</dl><ol class="event-list">{#each item.events as event}<li>{dateTime(event.at)} · {event.type}<p>{event.detail||''}</p></li>{/each}</ol></details>
    {#if !['filling','awaiting_verification','submitting','outcome_unknown'].includes(item.state)}<button class="ghost danger" onclick={()=>modal={kind:'deleteSubmission',item}}>Hapus catatan lokal</button>{/if}</article>{:else}<div class="empty-note">Belum ada pengiriman.</div>{/each}
    <div class="wizard-actions"><button onclick={()=>{screen='wizard';step=0;}}>Siapkan perjalanan baru</button></div>
  {:else if screen === 'data'}
    <div class="eyebrow">Data & bantuan</div><h1>Simpan salinan data Anda</h1><p>Profil, OCR, dan riwayat berada di browser ini. Cadangan berisi data pribadi dalam teks terbuka. Simpan di tempat yang Anda kendalikan.</p>
    <div class="data-actions"><button onclick={()=>run(async()=>download('mdac-desk-backup.json',JSON.stringify(await repository.exportBackup(),null,2),'application/json'))}>Ekspor cadangan</button><button onclick={()=>restoreInput.click()}>Pulihkan cadangan</button><input hidden bind:this={restoreInput} type="file" accept="application/json,.json" onchange={restore} /></div>
    <p>Foto paspor dibaca dengan OCR lokal dan tidak disimpan dalam profil. Saat Kirim dipilih, hanya data teks pada tinjauan yang diproses sementara untuk mengisi formulir resmi.</p><p>Sesi browser dan data teks dihapus setelah selesai, setelah 3 menit tanpa interaksi, atau paling lama 15 menit. Penanda pengajuan tanpa nama dan nomor paspor dipertahankan sampai 7 hari setelah tanggal tiba untuk mencegah pengiriman ulang yang belum jelas hasilnya.</p>
    <p>MDAC Desk tidak membaca bukti penerimaan secara otomatis. Catatan referensi hanya berasal dari pemeriksaan Anda di <a href={CHECK_URL} target="_blank" rel="noreferrer">Check Registration</a>.</p>
    <button disabled={persistent===true} onclick={()=>run(async()=>{persistent=await navigator.storage?.persist?.()??false;toast=persistent?'Browser mengizinkan penyimpanan persisten. Tetap ekspor cadangan.':'Browser belum memberi izin persisten. Simpan cadangan.';})}>Pertahankan penyimpanan browser</button><button class="danger" disabled={blocked} onclick={()=>{clearText='';modal={kind:'clear'};}}>Hapus seluruh data lokal</button>
    <div class="wizard-actions"><button onclick={()=>{screen='wizard';step=0;}}>Kembali ke penumpang</button></div>
  {/if}
  </section><footer class="wizard-footer">MDAC Desk · Alat persiapan independen <a href={OFFICIAL_URL} target="_blank" rel="noreferrer">Portal resmi MDAC ↗</a></footer>
  {/if}
</main>
{#if modal?.kind==='profile'}<ProfileDialog {repository} {profiles} initial={modal.initial} initialMode={modal.mode} {labels} {displayValue} {saved} close={()=>modal=null} />
{:else if modal}<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabindex="-1"><div class="modal-header"><h2 id="dialog-title">{modal.kind==='reconcile'?'Catat hasil pemeriksaan':'Hapus data lokal?'}</h2><button aria-label="Tutup dialog" class="ghost" onclick={()=>modal=null}>×</button></div><div class="modal-body">
{#if modal.kind==='reconcile'}<p>Periksa paspor {modal.item.profileSnapshot.passportNo} dan tanggal tiba {modal.item.tripSnapshot.arrival} di <a href={CHECK_URL} target="_blank" rel="noreferrer">Check Registration resmi MDAC</a>.</p><label>Referensi bukti / PIN<input bind:value={reviewReference} /></label><label class="check-label"><input type="checkbox" bind:checked={reconciliationReviewed} /><span>Saya memeriksa pendaftaran di situs resmi dan mencocokkan identitas serta tanggal tiba. Catatan ini adalah konfirmasi saya sebagai pengguna.</span></label>
{:else}<p>{modal.kind==='clear'?'Seluruh profil, antrean, dan riwayat akan dihapus dari browser ini. Ekspor cadangan sebelum melanjutkan.':'Catatan dihapus dari browser ini. Salinan dalam riwayat lain tetap tersimpan.'} Tindakan ini tidak membatalkan pendaftaran di portal MDAC.</p>{#if modal.kind==='clear'}<label>Ketik HAPUS<input bind:value={clearText} /></label>{/if}{/if}
</div><div class="modal-footer"><button onclick={()=>modal=null}>Batal</button>{#if modal.kind==='reconcile'}<button class="primary" onclick={reconcile} disabled={busy||!reviewReference.trim()||!reconciliationReviewed}>Simpan konfirmasi pengguna</button>{:else}<button class="danger" onclick={remove} disabled={busy||(modal.kind==='clear'&&clearText!=='HAPUS')}>Hapus</button>{/if}</div></div></div>{/if}
