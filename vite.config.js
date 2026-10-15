import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [sveltekit({adapter:adapter({ runtime: 'nodejs24.x', regions: ['sin1'], maxDuration: 120 })})],
  test: {include:['tests/**/*.test.js'],environment:'node'}
});
