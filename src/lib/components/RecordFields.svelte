<script>
  import { options, cities } from '#lib/domain/schema.js';
  export let value;
  export let kind = 'profile';
  export let minArrival = '';
  export let maxArrival = '';
  const maxLengths = { name: 60, passportNo: 12, phone: 12, email: 100, transportNo: 30, address1: 100, address2: 100 };
  const profile = [
    { key: 'name', label: 'Nama lengkap sesuai paspor', wide: true, placeholder: 'Tanpa gelar atau singkatan' },
    { key: 'passportNo', label: 'Nomor paspor', placeholder: 'Pertahankan angka nol di awal' },
    { key: 'nationality', label: 'Kewarganegaraan', options: options.nationality },
    { key: 'birthDate', label: 'Tanggal lahir', type: 'date' },
    { key: 'birthPlace', label: 'Negara kelahiran', options: options.nationality },
    { key: 'sex', label: 'Jenis kelamin', options: options.sex },
    { key: 'passportExpiry', label: 'Paspor berlaku hingga', type: 'date' },
    { key: 'email', label: 'Email penerima bukti', type: 'email', wide: true, placeholder: 'nama@email.com' },
    { key: 'phoneCountry', label: 'Kode telepon negara', options: options.region },
    { key: 'phone', label: 'Nomor telepon', placeholder: 'Nomor tanpa kode negara', inputmode: 'tel' }
  ];
  const trip = [
    { key: 'arrival', label: 'Tanggal tiba di Malaysia', type: 'date' },
    { key: 'departure', label: 'Tanggal meninggalkan Malaysia', type: 'date' },
    { key: 'travelMode', label: 'Moda perjalanan', options: options.trvlMode },
    { key: 'transportNo', label: 'Nomor penerbangan / kendaraan', placeholder: 'Contoh format AK 389' },
    { key: 'embarkation', label: 'Negara keberangkatan terakhir', options: options.nationality },
    { key: 'accommodationKind', label: 'Jenis penginapan', options: options.accommodationStay },
    { key: 'address1', label: 'Alamat penginapan', wide: true, placeholder: 'Nama hotel, jalan, dan nomor. Minimal 3 kata.' },
    { key: 'address2', label: 'Alamat tambahan', wide: true, optional: true },
    { key: 'state', label: 'Negeri / wilayah', options: options.accommodationState },
    { key: 'city', label: 'Kota', options: [] },
    { key: 'postcode', label: 'Kode pos', inputmode: 'numeric', placeholder: 'Pertahankan angka nol di awal' }
  ];
  $: fields = kind === 'profile' ? profile : trip;
</script>

<div class="field-grid">
  {#each fields as field}
    <label class:wide={field.wide}>
      <span>{field.label}{#if field.optional}<small> opsional</small>{/if}</span>
      {#if field.options}
        <select bind:value={value[field.key]} on:change={() => { if (field.key === 'state') value = { ...value, city: '', postcode: '' }; }}>
          <option value="">Pilih {field.label.toLowerCase()}</option>
          {#each field.key === 'city' ? (cities[value.state] || []) : field.options as option}<option value={option.value}>{option.label}</option>{/each}
        </select>
      {:else}
        <input type={field.type || 'text'} bind:value={value[field.key]} placeholder={field.placeholder || ''} inputmode={field.inputmode} min={field.key === 'arrival' ? minArrival : field.key === 'departure' ? value.arrival : undefined} max={field.key === 'arrival' ? maxArrival : undefined} autocomplete="off" maxlength={maxLengths[field.key]} />
      {/if}
    </label>
  {/each}
</div>
