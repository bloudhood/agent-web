function readToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem('cc-web-token');
}

function createAuthStore() {
  let token = $state<string | null>(readToken());
  let mustChangePassword = $state(false);
  let lastError = $state<string | null>(null);
  let banned = $state(false);

  return {
    get token() { return token; },
    get mustChangePassword() { return mustChangePassword; },
    get lastError() { return lastError; },
    get banned() { return banned; },
    get authed() { return !!token; },

    setToken(next: string | null) {
      token = next;
      if (next) localStorage.setItem('cc-web-token', next);
      else localStorage.removeItem('cc-web-token');
    },
    setMustChange(value: boolean) { mustChangePassword = value; },
    setError(message: string | null) { lastError = message; },
    setBanned(value: boolean) { banned = value; },
    clear() {
      token = null;
      mustChangePassword = false;
      lastError = null;
      banned = false;
      localStorage.removeItem('cc-web-token');
    },
  };
}

export const authStore = createAuthStore();
