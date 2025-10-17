import { EventEmitter } from 'node:events';

const DEFAULT_MAX_LISTENERS = 50;

/**
 * @typedef {{ error?: (message: string, error: unknown) => void }} ModuleLogger
 */

export class ModuleEventBus {
  /**
   * @param {{ logger?: ModuleLogger }} [options]
   */
  constructor({ logger } = {}) {
    this.#emitter = new EventEmitter({ captureRejections: true });
    this.#emitter.setMaxListeners(DEFAULT_MAX_LISTENERS);
    this.#logger = logger ?? console;
  }

  #emitter;
  #logger;

  on(event, listener) {
    this.#emitter.on(event, listener);
    return () => {
      this.#emitter.off(event, listener);
    };
  }

  registerHandler(event, handler) {
    const listeners = this.#emitter.listeners(event);
    if (listeners.length > 0) {
      throw new Error(`Module event handler already registered for ${event}`);
    }
    return this.on(event, async payload => {
      try {
        return await handler(payload, this);
      } catch (error) {
        this.#logger?.error?.(`Module handler for ${event} failed`, error);
        throw error;
      }
    });
  }

  async emit(event, payload) {
    const listeners = this.#emitter.listeners(event);
    if (listeners.length === 0) {
      return [];
    }
    const results = [];
    for (const listener of listeners) {
      results.push(await listener(payload));
    }
    return results;
  }

  async dispatch(event, payload) {
    const results = await this.emit(event, payload);
    return results.length ? results[results.length - 1] : undefined;
  }
}

export function createModuleEventBus(options) {
  return new ModuleEventBus(options);
}
