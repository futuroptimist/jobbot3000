const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled']);
const FALSY_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled']);

function normalize(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : undefined;
}

export function resolveAllowRemoteAccess({ args = [], env = {} } = {}) {
  const argv = Array.isArray(args) ? args : [];

  const allowFlagValues = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--allow-remote-access' || arg.startsWith('--allow-remote-access=')) {
      if (arg && arg.includes('=')) {
        const [, value = ''] = arg.split('=', 2);
        allowFlagValues.push(normalize(value));
      } else {
        const nextArg = argv[index + 1];
        if (nextArg === undefined || nextArg.startsWith('--')) {
          allowFlagValues.push(null);
        } else {
          allowFlagValues.push(normalize(nextArg));
          index += 1;
        }
      }
    }
  }
  const hasAllowFlag = allowFlagValues.length > 0;
  const hasDenyFlag = argv.some(
    arg => arg === '--deny-remote-access' || arg.startsWith('--deny-remote-access='),
  );

  if (hasAllowFlag && hasDenyFlag) {
    throw new Error('Provide only one of --allow-remote-access or --deny-remote-access');
  }

  if (hasAllowFlag) {
    let sawTruthy = false;
    let sawFalsy = false;

    for (const parsed of allowFlagValues) {
      if (parsed && TRUTHY_VALUES.has(parsed)) {
        sawTruthy = true;
        continue;
      }
      if (parsed && FALSY_VALUES.has(parsed)) {
        sawFalsy = true;
        continue;
      }
      if (parsed === null) {
        sawTruthy = true;
        continue;
      }
      // Default-deny: treat any non-null, unrecognized, or empty value as falsy to avoid
      // accidentally enabling remote access when the flag value is malformed.
      sawFalsy = true;
    }

    if (sawTruthy && sawFalsy) {
      throw new Error(
        'Conflicting --allow-remote-access values detected; all --allow-remote-access flags '
          + 'must have consistent values to avoid remote exposure',
      );
    }

    if (sawTruthy) return true;
    if (sawFalsy) return false;
  }
  if (hasDenyFlag) {
    return false;
  }

  const envValue = normalize(env.JOBBOT_WEB_ALLOW_REMOTE);
  if (envValue && TRUTHY_VALUES.has(envValue)) return true;
  if (envValue && FALSY_VALUES.has(envValue)) return false;

  return undefined;
}
