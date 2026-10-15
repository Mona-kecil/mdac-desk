import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [sveltekit({adapter:adapter({fallback:'200.html'})})],
  test: {include:['tests/**/*.test.js'],environment:'node'}
});
