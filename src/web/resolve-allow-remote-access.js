const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSY_VALUES = new Set(['0', 'false', 'no', 'off']);

function normalize(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : undefined;
}

export function resolveAllowRemoteAccess({ args = [], env = {} } = {}) {
  const argv = Array.isArray(args) ? args : [];
  if (argv.includes('--allow-remote-access')) {
    return true;
  }
  if (argv.includes('--deny-remote-access')) {
    return false;
  }

  const envValue = normalize(env.JOBBOT_WEB_ALLOW_REMOTE);
  if (envValue && TRUTHY_VALUES.has(envValue)) return true;
  if (envValue && FALSY_VALUES.has(envValue)) return false;

  return undefined;
}
