const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled']);
const FALSY_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled']);

function normalize(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : undefined;
}

export function resolveAllowRemoteAccess({ args = [], env = {} } = {}) {
  const argv = Array.isArray(args) ? args : [];

  const hasAllowFlag = argv.includes('--allow-remote-access');
  const hasDenyFlag = argv.includes('--deny-remote-access');

  if (hasAllowFlag && hasDenyFlag) {
    throw new Error('Provide only one of --allow-remote-access or --deny-remote-access');
  }

  if (hasAllowFlag) {
    return true;
  }
  if (hasDenyFlag) {
    return false;
  }

  const envValue = normalize(env.JOBBOT_WEB_ALLOW_REMOTE);
  if (envValue && TRUTHY_VALUES.has(envValue)) return true;
  if (envValue && FALSY_VALUES.has(envValue)) return false;

  return undefined;
}
