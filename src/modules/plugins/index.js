const DEFAULT_LOGGER = console;

function ensureLogger(logger) {
  if (!logger) return DEFAULT_LOGGER;
  return logger;
}

function cloneValue(value) {
  if (value === undefined || value === null) return value;
  if (typeof globalThis.structuredClone === 'function') {
    try {
      return globalThis.structuredClone(value);
    } catch {
      // Fall back to JSON cloning below.
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function normalizePluginDefinition(plugin) {
  if (!plugin || typeof plugin !== 'object') {
    throw new Error('Plugin definition must be an object');
  }
  const id = typeof plugin.id === 'string' ? plugin.id.trim() : '';
  if (!id) {
    throw new Error('Plugin id is required');
  }
  const description =
    typeof plugin.description === 'string' ? plugin.description.trim() : null;

  let register = null;
  if (plugin.register !== undefined) {
    if (typeof plugin.register !== 'function') {
      throw new Error(`Plugin ${id} register must be a function when provided`);
    }
    register = plugin.register;
  } else if (plugin.setup !== undefined) {
    if (typeof plugin.setup !== 'function') {
      throw new Error(`Plugin ${id} setup must be a function when provided`);
    }
    register = plugin.setup;
  }

  const eventsSource = plugin.events ?? plugin.handlers ?? {};
  const events = {};
  if (eventsSource && typeof eventsSource === 'object') {
    for (const [name, handler] of Object.entries(eventsSource)) {
      if (typeof handler !== 'function') {
        throw new Error(
          `Plugin ${id} event handler for "${name}" must be a function`,
        );
      }
      events[name] = handler;
    }
  } else if (eventsSource !== undefined) {
    throw new Error(`Plugin ${id} events must be an object when provided`);
  }

  if (!register && Object.keys(events).length === 0) {
    throw new Error(
      `Plugin ${id} must provide a register function or one or more events`,
    );
  }

  return { id, description, register, events };
}

function addDefinition(definitions, plugin) {
  const normalized = normalizePluginDefinition(plugin);
  if (definitions.has(normalized.id)) {
    throw new Error(`Plugin with id "${normalized.id}" already registered`);
  }
  definitions.set(normalized.id, normalized);
}

export function registerPluginsModule({
  bus,
  config,
  plugins = [],
  logger,
} = {}) {
  if (!bus || typeof bus.registerHandler !== 'function' || typeof bus.on !== 'function') {
    throw new Error('registerPluginsModule requires a module event bus');
  }

  const log = ensureLogger(logger);
  const definitions = new Map();
  const configEntries = Array.isArray(config?.plugins) ? config.plugins : [];

  for (const plugin of plugins ?? []) {
    addDefinition(definitions, plugin);
  }

  for (const entry of configEntries) {
    if (entry && typeof entry === 'object' && (entry.register || entry.events)) {
      addDefinition(definitions, entry);
    }
  }

  const metadata = [];
  const disposers = [];
  const pluginConfigById = new Map();
  for (const entry of configEntries) {
    if (!entry || typeof entry !== 'object') continue;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!id) continue;
    pluginConfigById.set(id, entry);
  }

  for (const [id, definition] of definitions) {
    const configEntry = pluginConfigById.get(id);
    if (configEntry?.enabled === false) {
      continue;
    }

    const pluginOptions = configEntry?.options ?? {};
    const context = {
      bus,
      logger: log,
      options: cloneValue(pluginOptions),
      config,
      id,
    };

    const cleanupFns = [];
    try {
      if (definition.register) {
        const result = definition.register(context);
        if (typeof result === 'function') {
          cleanupFns.push(result);
        } else if (result && typeof result.dispose === 'function') {
          cleanupFns.push(() => result.dispose());
        }
      }

      for (const [eventName, handler] of Object.entries(definition.events)) {
        const remove = bus.on(eventName, payload => handler(payload, context));
        cleanupFns.push(remove);
      }

      metadata.push(
        Object.freeze({
          id,
          description: definition.description,
          events: Object.freeze(Object.keys(definition.events)),
          options: cloneValue(pluginOptions),
        }),
      );

      disposers.push(() => {
        while (cleanupFns.length) {
          const dispose = cleanupFns.pop();
          try {
            dispose?.();
          } catch (error) {
            log?.error?.(`Plugin ${id} cleanup failed`, error);
          }
        }
      });
    } catch (error) {
      log?.error?.(`Failed to initialize plugin ${id}`, error);
      while (cleanupFns.length) {
        const dispose = cleanupFns.pop();
        try {
          dispose?.();
        } catch (cleanupError) {
          log?.error?.(`Plugin ${id} cleanup failed`, cleanupError);
        }
      }
    }
  }

  for (const entry of configEntries) {
    if (!entry || typeof entry !== 'object') continue;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!id || definitions.has(id)) continue;
    log?.warn?.(`Plugin definition not found for id "${id}". Skipping configuration entry.`);
  }

  const handlerDisposers = [
    bus.registerHandler('plugins:list', async () =>
      metadata.map(item => ({
        id: item.id,
        description: item.description,
        events: [...item.events],
        options: cloneValue(item.options),
      })),
    ),
  ];

  return () => {
    while (disposers.length) {
      const dispose = disposers.pop();
      try {
        dispose?.();
      } catch (error) {
        log?.error?.('Plugin cleanup failed', error);
      }
    }
    while (handlerDisposers.length) {
      const dispose = handlerDisposers.pop();
      try {
        dispose?.();
      } catch (error) {
        log?.error?.('Plugin handler cleanup failed', error);
      }
    }
  };
}
