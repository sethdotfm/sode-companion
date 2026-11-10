// Reads a Sode panel link (the shape src/vendor/panellink.js builds) back into connection settings. Pure.
// null when the text is not an http(s) link to a panel. A missing port takes the scheme's default, as a browser does.
export function parseSodeLink(text) {
  let url;
  try {
    url = new URL(String(text ?? '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const at = parts.lastIndexOf('panels');
  const panel = at >= 0 && parts[at + 1] ? decodeURIComponent(parts[at + 1]) : '';
  if (!url.hostname || !panel) return null;
  const tls = url.protocol === 'https:';
  const hash = new URLSearchParams(url.hash.slice(1));
  return {
    // new URL keeps the brackets on an IPv6 host, which is what a URL base wants.
    host: url.hostname,
    port: url.port ? Number(url.port) : tls ? 443 : 80,
    tls,
    panel,
    key: hash.get('key') || '',
    device: url.searchParams.get('instance')?.trim() || '',
  };
}
