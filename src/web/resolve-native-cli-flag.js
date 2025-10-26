const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled']);
const FALSY_VALUES = new Set(['0', 'false', 'no', 'off', 'disabled']);

function toLowerCaseString(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : undefined;
}

export function resolveEnableNativeCli({ args = [], env = {}, configEnv } = {}) {
  const argv = Array.isArray(args) ? args : [];
  const hasDisableFlag = argv.some(arg => arg === '--disable-native-cli');
  const hasEnableFlag = argv.some(arg => arg === '--enable-native-cli');

  if (hasDisableFlag) {
    return false;
  }

  if (hasEnableFlag) {
    return true;
  }

  const envValue = toLowerCaseString(env?.JOBBOT_WEB_ENABLE_NATIVE_CLI);
  if (envValue && (TRUTHY_VALUES.has(envValue) || FALSY_VALUES.has(envValue))) {
    return undefined;
  }

  const normalizedConfigEnv = toLowerCaseString(configEnv);
  if (!normalizedConfigEnv || normalizedConfigEnv === 'development') {
    return true;
  }

  return undefined;
}
