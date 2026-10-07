import { WebSocket } from "ws";

// Ownership travels beside the event, never in its serialized public payload.
export function createSessionEventStream({
  sessionManager,
  isCredentialValid,
  logger,
}) {
  const clients = new Map();

  function valid(scope) {
    return (
      Boolean(scope?.sessionId) &&
      sessionManager.remainingLifetime(scope.sessionId) > 0 &&
      isCredentialValid(scope.credential)
    );
  }

  function remove(client) {
    const entry = clients.get(client);
    if (!entry) return;
    clearTimeout(entry.timer);
    clients.delete(client);
    client.off("close", entry.onClose);
  }

  function terminate(client) {
    remove(client);
    client.terminate();
  }

  const unsubscribe = sessionManager.onInvalidate((sessionId) => {
    for (const [client, { scope }] of clients) {
      if (scope.sessionId === sessionId) terminate(client);
    }
  });

  function add(client, scope) {
    if (!valid(scope)) {
      client.terminate();
      return;
    }
    const entry = {
      scope: { ...scope },
      onClose: () => remove(client),
      timer: null,
    };
    clients.set(client, entry);
    client.once("close", entry.onClose);
    const checkDeadline = () => {
      if (!valid(entry.scope)) {
        terminate(client);
        return;
      }
      // HTTP activity may extend idle time; always re-read the current deadline.
      entry.timer = setTimeout(
        checkDeadline,
        Math.min(
          sessionManager.remainingLifetime(entry.scope.sessionId),
          2 ** 31 - 1,
        ),
      );
      entry.timer.unref?.();
    };
    checkDeadline();
  }

  function publish(event, scope) {
    // Invalidate stale subscribers even when the event has no usable ownership.
    for (const [client, entry] of clients) {
      if (!valid(entry.scope)) terminate(client);
    }
    if (!valid(scope)) return;
    let payload;
    try {
      payload = JSON.stringify(event);
    } catch (error) {
      logger?.warn?.("Failed to serialize command event", error);
      return;
    }
    for (const [client, entry] of clients) {
      if (
        entry.scope.sessionId !== scope.sessionId ||
        entry.scope.credential !== scope.credential
      )
        continue;
      // Check after serialization and immediately before sending, without renewal.
      if (!valid(scope) || !valid(entry.scope) || client.bufferedAmount > 0) {
        terminate(client);
        continue;
      }
      if (client.readyState !== WebSocket.OPEN) continue;
      try {
        client.send(payload, (error) => {
          if (error) terminate(client);
        });
      } catch (error) {
        terminate(client);
        logger?.warn?.("Failed to send command event", error);
      }
    }
  }

  function close() {
    unsubscribe();
    for (const client of clients.keys()) terminate(client);
  }

  return { add, publish, close };
}
