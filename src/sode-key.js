// The key as Sode wants it in a Bearer header: the web UI shows it without the `sode_` prefix. Never log the result.
export const withPrefix = (raw) => {
  const key = String(raw || '').trim();
  return key && !key.startsWith('sode_') ? `sode_${key}` : key;
};
