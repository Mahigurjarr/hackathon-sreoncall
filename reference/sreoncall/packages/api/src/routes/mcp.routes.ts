import { Router, Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from '../mcp/server';
import { logger } from '../utils/logger';

const router = Router();

// POST /mcp — stateless Streamable HTTP transport. Each request is
// independently authenticated (apiKeyAuthMiddleware, mounted in app.ts), so a
// fresh McpServer + transport is created per request rather than reused
// across a session — there is no session, by design, matching the API key's
// own stateless auth model.
router.post('/', async (req: Request, res: Response) => {
  try {
    const server = createMcpServer({
      tenantId: req.tenantId,
      apiKeyId: req.apiKeyId!,
      permissions: req.apiKeyPermissions ?? [],
      ip: req.ip || req.socket.remoteAddress || 'unknown',
      userAgent: (req.headers['user-agent'] as string) || 'unknown',
    });

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err: any) {
    logger.error('MCP request handling failed', { error: err.message });
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

export default router;
