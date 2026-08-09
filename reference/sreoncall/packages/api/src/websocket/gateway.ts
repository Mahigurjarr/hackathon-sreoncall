import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { getConfig } from '../config/index';
import { getNatsConnection } from '../config/nats';
import { StringCodec, Subscription } from 'nats';
import { logger } from '../utils/logger';

interface AuthenticatedSocket extends WebSocket {
  tenantId: string;
  userId: string;
  roles: string[];
  isAlive: boolean;
  natsSubscriptions: Subscription[];
}

const sc = StringCodec();

export function setupWebSocketGateway(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Heartbeat interval to detect stale connections
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const socket = ws as AuthenticatedSocket;
      if (!socket.isAlive) {
        cleanupSocket(socket);
        socket.terminate();
        return;
      }
      socket.isAlive = false;
      socket.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  wss.on('connection', async (ws: WebSocket, req) => {
    const socket = ws as AuthenticatedSocket;
    socket.isAlive = true;
    socket.natsSubscriptions = [];

    // Extract token from query string
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      socket.close(4001, 'Authentication required');
      return;
    }

    // Verify JWT
    const config = getConfig();
    let payload: any;
    try {
      payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
    } catch (err) {
      socket.close(4001, 'Invalid token');
      return;
    }

    socket.tenantId = payload.tenant_id;
    socket.userId = payload.sub;
    socket.roles = payload.roles || [];

    logger.info('WebSocket client connected', {
      userId: socket.userId,
      tenantId: socket.tenantId,
    });

    // Subscribe to NATS subjects for this tenant
    try {
      const nc = getNatsConnection();
      const subject = `tickets.*.${socket.tenantId}`;

      // Subscribe to tenant-specific events
      const sub = nc.subscribe(`tickets.>`);
      socket.natsSubscriptions.push(sub);

      (async () => {
        for await (const msg of sub) {
          try {
            const data = JSON.parse(sc.decode(msg.data));
            // Only forward events for this tenant
            if (data.tenant_id === socket.tenantId) {
              if (socket.readyState === WebSocket.OPEN) {
                socket.send(
                  JSON.stringify({
                    type: 'event',
                    subject: msg.subject,
                    data,
                  })
                );
              }
            }
          } catch (err: any) {
            logger.error('Failed to process NATS message for WebSocket', {
              error: err.message,
            });
          }
        }
      })().catch(() => {});

      // Also subscribe to notification events
      const notifSub = nc.subscribe('notifications.>');
      socket.natsSubscriptions.push(notifSub);

      (async () => {
        for await (const msg of notifSub) {
          try {
            const data = JSON.parse(sc.decode(msg.data));
            if (data.tenant_id === socket.tenantId && data.user_id === socket.userId) {
              if (socket.readyState === WebSocket.OPEN) {
                socket.send(
                  JSON.stringify({
                    type: 'notification',
                    subject: msg.subject,
                    data,
                  })
                );
              }
            }
          } catch (err: any) {
            logger.error('Failed to process notification for WebSocket', {
              error: err.message,
            });
          }
        }
      })().catch(() => {});

      // Subscribe to communications events
      const commsSub = nc.subscribe('comms.>');
      socket.natsSubscriptions.push(commsSub);

      (async () => {
        for await (const msg of commsSub) {
          try {
            const data = JSON.parse(sc.decode(msg.data));
            if (data.provider_tenant_id === socket.tenantId) {
              if (socket.readyState === WebSocket.OPEN) {
                socket.send(
                  JSON.stringify({
                    type: 'comms',
                    subject: msg.subject,
                    data,
                  })
                );
              }
            }
          } catch (err: any) {
            logger.error('Failed to process comms message for WebSocket', {
              error: err.message,
            });
          }
        }
      })().catch(() => {});

      // Subscribe to AI Notetaker live transcript segments (off-stream core NATS)
      const notetakerSub = nc.subscribe(`notetaker-live.${socket.tenantId}`);
      socket.natsSubscriptions.push(notetakerSub);

      (async () => {
        for await (const msg of notetakerSub) {
          try {
            const data = JSON.parse(sc.decode(msg.data));
            if (data.tenant_id === socket.tenantId) {
              if (socket.readyState === WebSocket.OPEN) {
                socket.send(
                  JSON.stringify({
                    type: 'notetaker',
                    subject: msg.subject,
                    data,
                  })
                );
              }
            }
          } catch (err: any) {
            logger.error('Failed to process notetaker segment for WebSocket', {
              error: err.message,
            });
          }
        }
      })().catch(() => {});

      // Subscribe to incident events (status changes, severity, ack, resolve, timeline)
      const incidentSub = nc.subscribe('incidents.>');
      socket.natsSubscriptions.push(incidentSub);

      (async () => {
        for await (const msg of incidentSub) {
          try {
            const data = JSON.parse(sc.decode(msg.data));
            if (data.tenant_id === socket.tenantId) {
              if (socket.readyState === WebSocket.OPEN) {
                socket.send(
                  JSON.stringify({
                    type: 'incident',
                    subject: msg.subject,
                    data,
                  })
                );
              }
            }
          } catch (err: any) {
            logger.error('Failed to process incident event for WebSocket', {
              error: err.message,
            });
          }
        }
      })().catch(() => {});
    } catch (err: any) {
      logger.warn('Failed to setup NATS subscription for WebSocket', {
        error: err.message,
        userId: socket.userId,
      });
    }

    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleClientMessage(socket, message);
      } catch (err: any) {
        logger.warn('Invalid WebSocket message from client', {
          userId: socket.userId,
          error: err.message,
        });
      }
    });

    socket.on('close', () => {
      cleanupSocket(socket);
      logger.info('WebSocket client disconnected', {
        userId: socket.userId,
        tenantId: socket.tenantId,
      });
    });

    socket.on('error', (err) => {
      logger.error('WebSocket error', {
        userId: socket.userId,
        error: err.message,
      });
      cleanupSocket(socket);
    });

    // Send connection acknowledgement
    socket.send(
      JSON.stringify({
        type: 'connected',
        userId: socket.userId,
        tenantId: socket.tenantId,
      })
    );
  });

  logger.info('WebSocket gateway initialized on /ws');
  return wss;
}

function handleClientMessage(socket: AuthenticatedSocket, message: any): void {
  switch (message.type) {
    case 'ping':
      socket.send(JSON.stringify({ type: 'pong' }));
      break;
    case 'subscribe':
      // Client can subscribe to specific channels (future use)
      logger.debug('WebSocket subscribe request', {
        userId: socket.userId,
        channel: message.channel,
      });
      break;
    default:
      logger.debug('Unknown WebSocket message type', {
        userId: socket.userId,
        type: message.type,
      });
  }
}

function cleanupSocket(socket: AuthenticatedSocket): void {
  if (socket.natsSubscriptions) {
    for (const sub of socket.natsSubscriptions) {
      sub.unsubscribe();
    }
    socket.natsSubscriptions = [];
  }
}
