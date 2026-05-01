export type App = 'claude' | 'codex' | 'gemini' | 'hermes';

export type Provider = {
  id: string;
  name: string;
  apiUrl?: string;
  current?: boolean;
  readonly?: boolean;
};

export type Health = {
  ok?: boolean;
  summary?: string;
  status?: string;
  error?: string;
  version?: string;
};

export interface AppState {
  ok: boolean;
  app: App;
  providers: Provider[];
  currentProviderId?: string;
  currentProviderName?: string;
  envStatus?: Health;
  toolStatus?: Health;
  error?: string;
}

export type CcSwitchState = {
  cli: { ok: boolean; path?: string; error?: string };
  toolStatus?: unknown;
  apps: Record<App, AppState>;
};

export const APP_META: Record<App, { label: string; glyph: string; color: string; soft: string }> = {
  claude: { label: 'Claude Code', glyph: 'C', color: '#d97757', soft: 'rgba(217,119,87,0.14)' },
  codex: { label: 'Codex CLI', glyph: 'X', color: '#6a9bcc', soft: 'rgba(106,155,204,0.16)' },
  gemini: { label: 'Gemini CLI', glyph: 'G', color: '#788c5d', soft: 'rgba(120,140,93,0.16)' },
  hermes: { label: 'Hermes WSL', glyph: 'H', color: '#141413', soft: 'rgba(20,20,19,0.08)' },
};
