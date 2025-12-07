const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled']);
const FALSY_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled']);

function normalize(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : undefined;
}

export function resolveAllowRemoteAccess({ args = [], env = {} } = {}) {
  const argv = Array.isArray(args) ? args : [];

  const hasAllowFlag = argv.some(
    arg => arg === '--allow-remote-access' || arg.startsWith('--allow-remote-access='),
  );
  const hasDenyFlag = argv.includes('--deny-remote-access');

  if (hasAllowFlag && hasDenyFlag) {
    throw new Error('Provide only one of --allow-remote-access or --deny-remote-access');
  }

  if (hasAllowFlag) {
    const flagIndex = argv.findIndex(
      arg => arg === '--allow-remote-access' || arg.startsWith('--allow-remote-access='),
    );
    const rawValue = argv[flagIndex];
    if (rawValue && rawValue.includes('=')) {
      const [, value] = rawValue.split('=', 2);
      const parsed = normalize(value);
      if (parsed && TRUTHY_VALUES.has(parsed)) return true;
      if (parsed && FALSY_VALUES.has(parsed)) return false;
    }
    const nextValue = normalize(argv[flagIndex + 1]);
    if (nextValue && TRUTHY_VALUES.has(nextValue)) return true;
    if (nextValue && FALSY_VALUES.has(nextValue)) return false;
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
