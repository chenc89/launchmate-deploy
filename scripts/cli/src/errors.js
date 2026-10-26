export class LaunchmateError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'LaunchmateError';
    this.code = options.code || 'LAUNCHMATE_ERROR';
    this.status = options.status;
  }
}

const CREDENTIAL_KEYS = new Set([
  'password', 'passwd', 'password_confirmation', 'new_password', 'current_password',
  'secret', 'token', 'authorization', 'api_key', 'api-key', 'access_token', 'auth_token',
  'refresh_token', 'private_key', 'private-key', 'client_secret', 'client-secret',
  'api_secret', 'secret_key', 'secret-key', 'access_key', 'secret_access_key',
  'aws_secret_access_key', 'database_password', 'db_password', 'app_key',
  'launchmate_token', 'netlify_token', 'github_token',
]);

function isCredentialKey(key) {
  const snakeCase = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  if (CREDENTIAL_KEYS.has(snakeCase)) return true;
  // 只把真实大写环境变量的凭据后缀当作秘密，tokenStorage 等普通配置不能误判。
  return /^[A-Z][A-Z0-9_]*$/.test(key)
    && /(?:^|_)(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|SECRET_KEY|PRIVATE_KEY|SECRET_ACCESS_KEY|AUTHORIZATION)(?:_(?:DEV|PROD|STAGING|TEST|LIVE))?$/.test(key);
}

function isDynamicCredentialReference(value) {
  return /^(?:Bearer\s+)?\$\{[A-Za-z_$][\w.$]*\}$/.test(value);
}

export function redactSecrets(value) {
  let text = String(value);
  const environmentToken = process.env.LAUNCHMATE_TOKEN;
  if (environmentToken) text = text.split(environmentToken).join('[REDACTED]');
  return text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/|=-]+/gi, '$1[REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/(["']?)([A-Za-z_][\w-]*)\1(\s*[:=]\s*)(["'`])([^\n\r]*?)\4/g, (match, keyQuote, key, separator, valueQuote, value) => {
      if (!isCredentialKey(key) || isDynamicCredentialReference(value)) return match;
      return `${keyQuote}${key}${keyQuote}${separator}${valueQuote}[REDACTED]${valueQuote}`;
    })
    .replace(/^([A-Z][A-Z0-9_]*)(\s*=\s*)([^\r\n]*)/gm, (match, key, separator) => isCredentialKey(key) ? `${key}${separator}[REDACTED]` : match);
}

export function safeError(error) {
  return { code: error.code || 'LAUNCHMATE_ERROR', message: redactSecrets(error.message || '操作失败'), ...(error.status ? { status: error.status } : {}) };
}
