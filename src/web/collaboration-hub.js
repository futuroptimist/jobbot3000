import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';

import { WebSocketServer } from 'ws';

const DEFAULT_PATH = '/collaboration';
const HEARTBEAT_INTERVAL_MS = 30_000;

function normalizePath(path) {
  if (typeof path !== 'string') {
    return DEFAULT_PATH;
  }
  try {
    const url = new URL(path, 'http://localhost');
    const normalized = url.pathname.endsWith('/')
      ? url.pathname.replace(/\/+/g, '/').replace(/\/$/, '')
      : url.pathname.replace(/\/+/g, '/');
    return normalized || DEFAULT_PATH;
  } catch {
    return path.startsWith('/') ? path : `/${path}`;
  }
}

function safeSend(socket, payload, logger) {
  if (!socket || socket.readyState !== socket.OPEN) {
    return;
  }
  try {
    socket.send(payload);
  } catch (error) {
    logger?.warn?.('Failed to send collaboration payload', error);
  }
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ type: 'collaboration:error', message: 'Invalid payload' });
  }
}

export function createCollaborationHub(options = {}) {
  const { path = DEFAULT_PATH, logger } = options;
  const normalizedPath = normalizePath(path);
  const clients = new Set();
  let webSocketServer = null;
  let heartbeatTimer = null;
  let serverRef = null;
  let upgradeListener = null;
  let closed = false;

  function cleanupClient(client) {
    try {
      client.terminate();
    } catch {
      // Ignore termination failures to avoid disrupting other clients.
    }
    clients.delete(client);
  }

  function handleHeartbeat() {
    for (const client of clients) {
      if (client.readyState !== client.OPEN) {
        cleanupClient(client);
        continue;
      }
      if (client.isAlive === false) {
        cleanupClient(client);
        continue;
      }
      client.isAlive = false;
      try {
        client.ping();
      } catch {
        cleanupClient(client);
      }
    }
  }

  function ensureServer() {
    if (!webSocketServer) {
      webSocketServer = new WebSocketServer({ noServer: true });
    }
    if (!heartbeatTimer) {
      heartbeatTimer = setInterval(handleHeartbeat, HEARTBEAT_INTERVAL_MS);
      if (typeof heartbeatTimer.unref === 'function') {
        heartbeatTimer.unref();
      }
    }
  }

  function detachUpgradeListener() {
    if (serverRef && upgradeListener) {
      serverRef.off('upgrade', upgradeListener);
    }
    upgradeListener = null;
  }

  async function closeWebSocketServer() {
    if (!webSocketServer) {
      return;
    }
    const serverToClose = webSocketServer;
    webSocketServer = null;
    await new Promise(resolve => {
      serverToClose.close(() => {
        resolve();
      });
    });
  }

  function publish(event) {
    if (!event || typeof event !== 'object') {
      return 0;
    }
    const payload = { ...event };
    if (!payload.timestamp) {
      payload.timestamp = new Date().toISOString();
    }
    const serialized = safeJsonStringify(payload);
    let delivered = 0;
    for (const client of clients) {
      if (client.readyState === client.OPEN) {
        safeSend(client, serialized, logger);
        delivered += 1;
      } else {
        cleanupClient(client);
      }
    }
    return delivered;
  }

  function attach(server) {
    if (closed) {
      throw new Error('Collaboration hub is closed');
    }
    if (!server || typeof server.on !== 'function') {
      throw new Error('An HTTP server instance is required for collaboration');
    }
    if (serverRef) {
      throw new Error('Collaboration hub already attached to a server');
    }

    ensureServer();
    serverRef = server;

    upgradeListener = (request, socket, head) => {
      if (closed) {
        socket.destroy();
        return;
      }
      const { url } = request;
      let pathname = '';
      try {
        pathname = new URL(url, 'http://localhost').pathname;
      } catch {
        pathname = typeof url === 'string' ? url : '';
      }
      if (!pathname) {
        socket.destroy();
        return;
      }
      const normalized = normalizePath(pathname);
      if (normalized !== normalizedPath) {
        return;
      }

      webSocketServer.handleUpgrade(request, socket, head, ws => {
        ws.isAlive = true;
        ws.connectionId = randomUUID();
        ws.on('pong', () => {
          ws.isAlive = true;
        });
        ws.on('error', error => {
          logger?.warn?.('Collaboration client error', error);
        });
        ws.on('close', () => {
          clients.delete(ws);
        });
        clients.add(ws);
        const acknowledgement = {
          type: 'collaboration:connected',
          connectionId: ws.connectionId,
          timestamp: new Date().toISOString(),
        };
        safeSend(ws, safeJsonStringify(acknowledgement), logger);
      });
    };

    serverRef.on('upgrade', upgradeListener);

    return () => {
      detachUpgradeListener();
      serverRef = null;
    };
  }

  async function close() {
    closed = true;
    detachUpgradeListener();
    serverRef = null;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    for (const client of Array.from(clients)) {
      try {
        client.close(1001, 'server shutting down');
      } catch {
        // Ignore shutdown errors per client.
      }
      clients.delete(client);
    }
    await closeWebSocketServer();
  }

  return {
    publish,
    attach,
    close,
    get path() {
      return normalizedPath;
    },
    get clientCount() {
      return clients.size;
    },
  };
}
