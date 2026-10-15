import { copyFile, mkdir } from 'node:fs/promises';
await mkdir(new URL('../static/', import.meta.url), { recursive: true });
await copyFile(new URL('../extension/adapter.js', import.meta.url), new URL('../static/fixture-adapter.js', import.meta.url));
