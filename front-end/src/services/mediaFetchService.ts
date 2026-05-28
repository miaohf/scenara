const DEFAULT_MEDIA_PROXY_ENDPOINT = '/api/media-proxy';
const mediaProxyEnabled =
  String(import.meta.env.VITE_MEDIA_PROXY_ENABLED ?? 'true').toLowerCase() !== 'false';
const configuredProxyEndpoint = String(import.meta.env.VITE_MEDIA_PROXY_ENDPOINT ?? '').trim();
const mediaProxyEndpoint = configuredProxyEndpoint || DEFAULT_MEDIA_PROXY_ENDPOINT;

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

const buildProxyUrl = (targetUrl: string): string => {
  const separator = mediaProxyEndpoint.includes('?') ? '&' : '?';
  return `${mediaProxyEndpoint}${separator}url=${encodeURIComponent(targetUrl)}`;
};

/**
 * Fetch remote media through same-origin Node proxy.
 * This avoids browser CORS failures on signed third-party URLs.
 */
export const fetchMediaWithCorsFallback = async (
  url: string,
  init?: RequestInit
): Promise<Response> => {
  if (!isHttpUrl(url) || !mediaProxyEnabled) {
    return fetch(url, init);
  }

  return fetch(buildProxyUrl(url), {
    method: init?.method || 'GET',
    headers: init?.headers,
    credentials: 'same-origin',
  });
};

