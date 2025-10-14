const ALLOW_ALL_POLICY = {
  requireAuthentication: false,
};

function normalizePolicy(policy) {
  if (!policy || typeof policy !== 'object') return ALLOW_ALL_POLICY;
  return {
    requireAuthentication: Boolean(policy.requireAuthentication),
    trustedPrincipals: Array.isArray(policy.trustedPrincipals) ? policy.trustedPrincipals : [],
  };
}

export function registerAuthModule({ bus, config } = {}) {
  if (!bus || typeof bus.registerHandler !== 'function') {
    throw new Error('registerAuthModule requires a module event bus');
  }

  const policy = normalizePolicy(config?.authPolicy);

  const handlers = [
    bus.registerHandler('auth:policy:get', async () => policy),
    bus.registerHandler('auth:principal:validate', async payload => {
      const { principal } = payload || {};
      if (!policy.requireAuthentication) {
        return { allowed: true, principal: principal ?? null };
      }
      if (!principal || typeof principal !== 'string') {
        return { allowed: false, reason: 'missing-principal' };
      }
      const normalized = principal.trim().toLowerCase();
      const isTrusted = policy.trustedPrincipals.some(entry => entry.toLowerCase() === normalized);
      return { allowed: isTrusted, principal: normalized };
    }),
  ];

  return () => handlers.splice(0).forEach(dispose => dispose?.());
}
