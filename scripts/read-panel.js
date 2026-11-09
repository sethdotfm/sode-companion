// Reads one panel from Sode for the generator command. Messages are fixed text: nothing here echoes the key or Sode's own error text.
import { withPrefix } from '../src/sode-key.js';

export class ReadFailed extends Error {}

const KEY_REFUSED = 'Sode refused the key. It is wrong or was revoked, so make a new one.';
const REFUSED = {
  invalid_key: KEY_REFUSED,
  key_required: KEY_REFUSED,
  key_expired: 'The key has expired. Make a new key for this panel.',
  network_not_allowed: "This network is not in the panel's allowed list. Run the command from an allowed network or change the list.",
  api_off: 'The API is switched off in Sode. Ask an administrator to turn it on.',
};

export async function readPanel({ host, port, tls, panel, key, fetch: doFetch = globalThis.fetch }) {
  const origin = `${tls ? 'https' : 'http'}://${host}:${port}`;
  let res;
  try {
    res = await doFetch(`${origin}/api/v1/panels/${encodeURIComponent(panel)}`, { headers: { Authorization: `Bearer ${withPrefix(key)}` }, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new ReadFailed(`Sode did not answer at ${origin}. Check the host, port and TLS choice.`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const known = REFUSED[body?.error?.code];
    if (known) throw new ReadFailed(known);
    if (res.status === 401) throw new ReadFailed(KEY_REFUSED);
    if (res.status === 404) throw new ReadFailed('Sode has no panel with this id or short name that this key may use.');
    throw new ReadFailed(`Sode answered with status ${res.status}, not a panel.`);
  }
  if (body.acts !== 'api') throw new ReadFailed('This panel acts as a user. Switch it to act as its own API client in the Sode editor.');
  return body;
}
