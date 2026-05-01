import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  // Don't force runes globally — node_modules packages may use legacy mode.
  // Our own files declare runes via the `<script lang="ts" module>` style or
  // by using $state/$props which Svelte 5 auto-detects as runes mode.
  compilerOptions: {},
};
