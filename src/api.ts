const TOKEN_KEY = 'ayurledger_token';
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

export function withApiBase(path: string) {
  if (!API_BASE_URL) {
    return path;
  }

  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  return path.startsWith('/') ? `${API_BASE_URL}${path}` : `${API_BASE_URL}/${path}`;
}

export const tokenStore = {
  get: (): string | null => {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token: string) => {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
    } catch {}
  },
  clear: () => {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {}
  },
};

type ApiOptions = Omit<RequestInit, 'body'> & { body?: unknown };

let fetchPatched = false;

function installAuthFetch() {
  if (fetchPatched || typeof window === 'undefined') {
    return;
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const resolvedInput =
      typeof input === 'string'
        ? withApiBase(input)
        : input instanceof URL && !input.protocol
          ? new URL(withApiBase(input.toString()), window.location.origin)
          : input;
    const token = tokenStore.get();
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));

    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await originalFetch(resolvedInput, {
      ...init,
      headers,
    });

    if (response.status === 401) {
      tokenStore.clear();
      window.dispatchEvent(new Event('ayurledger:logout'));
    }

    return response;
  };

  fetchPatched = true;
}

installAuthFetch();

async function apiFetch<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers ?? {});
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(withApiBase(path), {
    ...options,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (res.status === 401) {
    throw new Error('Session expired. Please log in again.');
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    if (isJson) {
      try {
        const err = await res.json();
        message = err.error ?? message;
      } catch {}
    } else {
      try {
        const text = await res.text();
        if (text.trim().startsWith('<!doctype') || text.trim().startsWith('<html')) {
          message = `API returned HTML instead of JSON for ${path}. Open the app via http://localhost:3000.`;
        }
      } catch {}
    }
    throw new Error(message);
  }

  if (!isJson) {
    const text = await res.text();
    if (text.trim().startsWith('<!doctype') || text.trim().startsWith('<html')) {
      throw new Error(`API returned HTML instead of JSON for ${path}. Open the app via http://localhost:3000.`);
    }
    throw new Error(`Unexpected non-JSON response for ${path}.`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T = unknown>(path: string, options?: ApiOptions) =>
    apiFetch<T>(path, { method: 'GET', ...options }),
  post: <T = unknown>(path: string, body?: unknown, options?: ApiOptions) =>
    apiFetch<T>(path, { method: 'POST', body, ...options }),
  put: <T = unknown>(path: string, body?: unknown, options?: ApiOptions) =>
    apiFetch<T>(path, { method: 'PUT', body, ...options }),
  patch: <T = unknown>(path: string, body?: unknown, options?: ApiOptions) =>
    apiFetch<T>(path, { method: 'PATCH', body, ...options }),
  delete: <T = unknown>(path: string, options?: ApiOptions) =>
    apiFetch<T>(path, { method: 'DELETE', ...options }),
};
