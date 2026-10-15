<script>
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import RecordFields from './RecordFields.svelte';
  import { emptyProfile, PROFILE_FIELDS } from '../domain/schema.js';
  import { validateProfile } from '../domain/validate.js';
  import { parseImport, CSV_TEMPLATE, MAX_FILE_BYTES, MAX_ROWS } from '../import/parse.js';
  import { readPassport } from '../import/ocr.js';
  export let repository, profiles, initial = null, initialMode = 'manual', labels, displayValue, saved, close;
  let profile = initial ? { ...initial } : emptyProfile();
  let profileMode = initialMode, reviewed = false, errors = [], busy = false, toast = null;
  let importFile, importResult = null, mapping = {}, reviewedRows = [], importReviewed = false;
  let ocrProgress = '', ocrIssues = [], ocrText = '';
  $: validImportRows = importResult?.rows.filter(item => importRowIssues(item, profiles, importResult.rows).length === 0) || [];
  function profileIdentity(item) {
    return item.nationality && item.passportNo
      ? `${item.nationality.trim()}|${item.passportNo.trim().toUpperCase()}`
      : "";
  }
  function importRowIssues(item, knownProfiles, rows) {
    const issues = [
      ...new Set([...item.issues, ...validateProfile(item.profile)]),
    ];
    const identity = profileIdentity(item.profile);
    const existing =
      identity &&
      knownProfiles.find((saved) => profileIdentity(saved) === identity);
    if (existing)
      issues.push(
        `Profil ${existing.name || existing.passportNo} sudah ada. Baris ini dilewati. Edit profil dari daftar penumpang untuk memperbaruinya.`,
      );
    const first =
      identity && rows.find((row) => profileIdentity(row.profile) === identity);
    if (first && first.row !== item.row)
      issues.push(
        `Paspor yang sama tercantum pada baris ${first.row}. Baris duplikat ini dilewati.`,
      );
    return issues;
  }
  function readableIssue(message) {
    return PROFILE_FIELDS.reduce(
      (text, key) => text.replaceAll(key, labels[key]),
      message,
    );
  }
  function toggleImportRow(row) {
    reviewedRows = reviewedRows.includes(row)
      ? reviewedRows.filter((item) => item !== row)
      : [...reviewedRows, row];
    importReviewed = false;
  }
  function toggleImportRows() {
    reviewedRows = validImportRows.every((item) =>
      reviewedRows.includes(item.row),
    )
      ? []
      : validImportRows.map((item) => item.row);
    importReviewed = false;
  }
  function dialogFocus(node) {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    queueMicrotask(() => node.focus());
    function keyboard(event) {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        closeModal();
      }
      if (event.key !== "Tab") return;
      const controls = [
        ...node.querySelectorAll(
          "button:not([disabled]),input:not([disabled]):not([hidden]),select:not([disabled]),a[href],summary",
        ),
      ].filter((item) => item.getClientRects().length);
      const first = controls[0];
      const last = controls.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === node)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    node.addEventListener("keydown", keyboard);
    return {
      destroy() {
        node.removeEventListener("keydown", keyboard);
        document.body.style.overflow = overflow;
        previous?.focus();
      },
    };
  }
  function notify(message, error = false) {
    toast = { message, error };
  }
  async function run(action) {
    busy = true;
    errors = [];
    try {
      await action();
    } catch (error) {
      notify(
        error.message || "Tindakan gagal. Periksa data lalu coba lagi.",
        true,
      );
    } finally {
      busy = false;
    }
  }
  function closeModal() { close(); }
  async function refresh() { await saved(); }
  async function saveProfile() {
    if (
      !profile.id &&
      profiles.some(
        (item) =>
          profileIdentity(profile) &&
          profileIdentity(item) === profileIdentity(profile),
      )
    ) {
      errors = [
        "Profil dengan paspor dan kewarganegaraan ini sudah ada. Buka Edit dari daftar penumpang untuk memperbaruinya.",
      ];
      return;
    }
    const issues = validateProfile(profile);
    if (reviewed && issues.length) {
      errors = issues;
      return;
    }
    await run(async () => {
      const result = await repository.saveProfile({
        ...profile,
        reviewedAt: reviewed ? new Date().toISOString() : null,
      });
      await saved([result.id]);
      closeModal();
      notify(
        reviewed
          ? "Profil ditinjau dan disimpan."
          : "Draf disimpan. Lengkapi dan tinjau sebelum mengantre.",
      );
    });
  }
  function downloadFile(name, contents, type) {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }
  async function importSpreadsheet(event) {
    importFile = event.currentTarget.files?.[0];
    if (!importFile) return;
    await run(async () => {
      importResult = await parseImport(importFile);
      mapping = Object.fromEntries(
        PROFILE_FIELDS.map((key) => [
          key,
          importResult.headers.includes(key) ? key : "",
        ]),
      );
      reviewedRows = [];
      importReviewed = false;
    });
  }
  async function remapImport() {
    await run(async () => {
      importResult = await parseImport(importFile, mapping);
      reviewedRows = [];
      importReviewed = false;
    });
  }
  async function saveImport() {
    if (!importReviewed) {
      errors = [
        "Tinjau setiap nilai pada baris terpilih, lalu centang pernyataan peninjauan.",
      ];
      return;
    }
    const rows = validImportRows.filter((item) =>
      reviewedRows.includes(item.row),
    );
    if (!rows.length) {
      errors = ["Pilih sedikitnya satu baris lengkap tanpa kesalahan."];
      return;
    }
    await run(async () => {
      const savedIds = [];
      for (const row of rows) {
        const result = await repository.saveProfile({
          ...row.profile,
          reviewedAt: new Date().toISOString(),
        });
        savedIds.push(result.id);
      }
      await saved(savedIds);
      close();
    });
  }
  async function scanPassport(event) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    await run(async () => {
      ocrProgress = "Menyiapkan pembaca paspor lokal…";
      const result = await readPassport(file, (progress) => {
        ocrProgress =
          typeof progress === "number"
            ? `Membaca paspor ${Math.round(progress * 100)}%`
            : typeof progress === "string"
              ? progress
              : `${progress.status || "Membaca paspor"} ${Math.round((progress.progress || 0) * 100)}%`;
      });
      profile = { ...emptyProfile(), ...result.profile };
      ocrIssues = result.issues;
      ocrText = result.text;
      reviewed = false;
      notify("Hasil OCR tersedia. Cocokkan setiap kolom dengan paspor.");
    });
    ocrProgress = "";
  }
</script>
<div class="modal-backdrop"><div class="modal" class:large={profileMode === 'spreadsheet'} use:dialogFocus role="dialog" aria-modal="true" aria-labelledby="profile-title" tabindex="-1">
<div class="modal-header"><div><h2 id="profile-title">{profile.id ? 'Tinjau profil penumpang' : 'Tambah penumpang'}</h2><p>Cocokkan setiap kolom dengan paspor dan kontak.</p></div><button class="ghost" aria-label="Tutup dialog" onclick={close} disabled={busy}>×</button></div>
<div class="modal-body">{#if errors.length}<div class="errors" role="alert"><ul>{#each errors as error}<li>{error}</li>{/each}</ul></div>{/if}
          {#if !profile.id}<div
              class="segmented"
              aria-label="Cara menambah penumpang"
            >
              <button
                class:active={profileMode === "manual"}
                onclick={() => {
                  profileMode = "manual";
                  errors = [];
                }}
                disabled={busy}
                ><Icon name="edit" size={15} /> Isi manual</button
              ><button
                class:active={profileMode === "spreadsheet"}
                onclick={() => {
                  profileMode = "spreadsheet";
                  errors = [];
                }}
                disabled={busy}
                ><Icon name="file" size={15} /> CSV / Excel</button
              ><button
                class:active={profileMode === "photo"}
                onclick={() => {
                  profileMode = "photo";
                  errors = [];
                }}
                disabled={busy}
                ><Icon name="scan" size={15} /> Foto paspor</button
              >
            </div>{/if}
          {#if profileMode === "spreadsheet"}
            <div class="upload-box">
              <Icon name="upload" size={27} />
              <h3>Impor daftar penumpang</h3>
              <p>
                CSV atau XLSX. Maksimal {Math.round(
                  MAX_FILE_BYTES / 1024 / 1024,
                )} MB dan {MAX_ROWS} baris. Format tanggal YYYY-MM-DD. Simpan nomor
                paspor dan telepon sebagai teks.
              </p>
              <input
                type="file"
                accept=".csv,.xlsx"
                aria-label="Pilih spreadsheet penumpang"
                onchange={importSpreadsheet}
                disabled={busy}
              /><button
                class="text-link"
                onclick={() =>
                  downloadFile(
                    "template-penumpang-mdac.csv",
                    CSV_TEMPLATE,
                    "text/csv;charset=utf-8",
                  )}
                ><Icon name="download" size={13} /> Unduh template CSV</button
              >
            </div>
            {#if importResult}<details>
                <summary>Cocokkan kolom spreadsheet</summary>
                <div class="mapping-grid">
                  {#each PROFILE_FIELDS as key}<label
                      ><span>{labels[key]}</span><select
                        bind:value={mapping[key]}
                        ><option value="">Tidak dipetakan</option
                        >{#each importResult.headers as header}<option
                            value={header}>{header}</option
                          >{/each}</select
                      ></label
                    >{/each}
                </div>
                <button class="small" onclick={remapImport} disabled={busy}
                  >Terapkan pemetaan</button
                >
              </details>
              {#if importResult.warnings.length}<div
                  class="notice warning top-spaced"
                >
                  <div>
                    {#each importResult.warnings as warning}<p>
                        {readableIssue(warning)}
                      </p>{/each}
                  </div>
                </div>{/if}
              <div class="section-label">
                Pratinjau {importResult.rows.length} baris · {validImportRows.length}
                lengkap
              </div>
              <p class="help-text">
                Buka Detail untuk memeriksa semua kolom. Hanya baris lengkap
                yang dapat dipilih. Perbaiki baris bermasalah di spreadsheet,
                lalu impor ulang.
              </p>
              <div class="table-wrap top-spaced">
                <table class="review-table">
                  <thead
                    ><tr
                      ><th
                        ><input
                          type="checkbox"
                          aria-label="Pilih semua baris lengkap"
                          checked={validImportRows.length > 0 &&
                            validImportRows.every((item) =>
                              reviewedRows.includes(item.row),
                            )}
                          onchange={toggleImportRows}
                        /></th
                      ><th>Baris / nama</th><th>Paspor</th><th>Pemeriksaan</th
                      ></tr
                    ></thead
                  ><tbody
                    >{#each importResult.rows as item}<tr
                        ><td
                          ><input
                            type="checkbox"
                            aria-label={`Pilih baris ${item.row}`}
                            checked={reviewedRows.includes(item.row)}
                            disabled={importRowIssues(
                              item,
                              profiles,
                              importResult.rows,
                            ).length > 0}
                            onchange={() => toggleImportRow(item.row)}
                          /></td
                        ><td
                          ><strong
                            >{item.row}. {item.profile.name ||
                              "Tanpa nama"}</strong
                          >
                          <details>
                            <summary>Detail semua kolom</summary>
                            <dl class="snapshot-list">
                              {#each PROFILE_FIELDS as key}<div>
                                  <dt>{labels[key]}</dt>
                                  <dd>
                                    {displayValue(key, item.profile[key])}
                                  </dd>
                                </div>{/each}
                            </dl>
                          </details></td
                        ><td class="mono"
                          >{item.profile.passportNo || "Belum diisi"}</td
                        ><td
                          >{#if !importRowIssues(item, profiles, importResult.rows).length}<span
                              class="badge">Lengkap</span
                            >{:else}{#each importRowIssues(item, profiles, importResult.rows) as issue}<p
                                class="error-text"
                              >
                                {readableIssue(issue)}
                              </p>{/each}{/if}</td
                        ></tr
                      >{/each}</tbody
                  >
                </table>
              </div>
              <label class="check-label top-spaced"
                ><input type="checkbox" bind:checked={importReviewed} /><span
                  >Saya telah mencocokkan seluruh data pada {reviewedRows.length}
                  baris terpilih dengan paspor dan kontak penumpang.</span
                ></label
              >{/if}
          {:else}
            {#if profileMode === "photo"}<div class="upload-box">
                <Icon name="scan" size={27} />
                <h3>Baca foto paspor di perangkat ini</h3>
                <p>
                  Pilih gambar halaman identitas dengan dua baris MRZ yang
                  terbaca. Gambar tidak diunggah dan tidak disimpan sebagai
                  bagian profil.
                </p>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="Pilih foto paspor"
                  onchange={scanPassport}
                  disabled={busy}
                />{#if ocrProgress}<p role="status">{ocrProgress}</p>{/if}
              </div>
              {#if ocrIssues.length}<div class="notice warning top-spaced">
                  <div>
                    {#each ocrIssues as issue}<p>{issue}</p>{/each}
                  </div>
                </div>{/if}{#if ocrText}<details>
                  <summary>Lihat teks hasil OCR</summary>
                  <pre
                    class="help-text"
                    style="white-space:pre-wrap;overflow-wrap:anywhere">{ocrText}</pre>
                </details>{/if}
              <div class="section-label">
                Tinjau & lengkapi hasil pembacaan
              </div>{/if}<RecordFields bind:value={profile} /><label
              class="check-label top-spaced"
              ><input type="checkbox" bind:checked={reviewed} /><span
                >Saya telah mencocokkan data dengan paspor dan memeriksa email
                serta nomor telepon. Profil ini siap digunakan.</span
              ></label
            >
            <p class="help-text" style="margin-top:10px">
              Belum lengkap? Biarkan kotak kosong untuk menyimpan draf.
            </p>
          {/if}

</div><div class="modal-footer"><small>Profil tersimpan di browser ini.</small><div class="actions"><button onclick={close} disabled={busy}>Batal</button>{#if profileMode === 'spreadsheet'}<button class="primary" onclick={saveImport} disabled={busy || !reviewedRows.length || !importReviewed}>Simpan {reviewedRows.length} baris ditinjau</button>{:else}<button class="primary" onclick={saveProfile} disabled={busy}>{reviewed ? 'Simpan profil ditinjau' : 'Simpan draf'}</button>{/if}</div></div>
{#if toast}<p class:error-text={toast.error} role={toast.error ? 'alert' : 'status'}>{toast.message}</p>{/if}
</div></div>
