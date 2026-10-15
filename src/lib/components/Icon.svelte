<script>
  export let name = "users";
  export let size = 20;
  const paths = {
    users:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
    send: "m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13",
    book: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z",
    plus: "M12 5v14M5 12h14",
    search: "m21 21-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
    arrow: "M7 17 17 7M7 7h10v10",
    chevron: "m9 5 7 7-7 7",
    check: "m5 12 4 4L19 6",
    shield: "M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Zm-4-11 3 3 5-5",
    upload: "M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4",
    download: "M12 4v12m-5-5 5 5 5-5M4 16v4h16v-4",
    file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M8 13h8M8 17h5",
    scan: "M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M4 12h16M8 8h8M8 16h8",
    edit: "m16 3 5 5-12 12H4v-5ZM14 5l5 5",
    close: "m6 6 12 12M6 18 18 6",
    trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
    clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
    plug: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0ZM12 17v5",
    plane: "m22 2-7 20-4-9-9-4 20-7ZM11 13l5-5",
    lock: "M5 11h14v11H5ZM8 11V7a4 4 0 0 1 8 0v4",
    info: "M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  };
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.65"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"><path d={paths[name] || paths.file} /></svg
>
