/**
 * UI store — global UI state via Svelte 5 runes.
 * Owns: theme, sidebar open/close, viewport meta.
 */

const VALID_THEMES = ['washi', 'washi-dark'] as const;
export type Theme = (typeof VALID_THEMES)[number];

function readInitialTheme(): Theme {
  if (typeof document === 'undefined') return 'washi';
  const t = document.documentElement.dataset.theme;
  return (t && (VALID_THEMES as readonly string[]).includes(t)) ? (t as Theme) : 'washi';
}

function isDesktop(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(min-width: 768px)').matches;
}

function createUiStore() {
  let theme = $state<Theme>(readInitialTheme());
  // Desktop: sidebar visible by default. Mobile: closed.
  let sidebarOpen = $state<boolean>(isDesktop());

  function setTheme(next: Theme) {
    theme = next;
    document.documentElement.dataset.theme = next;
    localStorage.setItem('cc-web-theme', next);
  }

  function openSidebar() { sidebarOpen = true; }
  function closeSidebar() {
    // On desktop the sidebar is always visible; "close" is a no-op there.
    if (isDesktop()) return;
    sidebarOpen = false;
  }
  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
  }

  return {
    get theme() { return theme; },
    get sidebarOpen() { return sidebarOpen; },
    setTheme,
    openSidebar,
    closeSidebar,
    toggleSidebar,
  };
}

export const uiStore = createUiStore();
