import { redactSecrets } from './errors.js';

export function sanitizeOutput(value) {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map(sanitizeOutput);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /^(?:plain_text_token|token|refresh_token|authorization|password|secret|api_key|access_token)$/i.test(key) ? '[REDACTED]' : sanitizeOutput(item)]));
  return value;
}

export function printJson(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(sanitizeOutput(value), null, 2)}\n`);
}
