import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools, McpToolContext } from './tools';

const SERVER_INFO = { name: 'sreoncall', version: '1.0.0' };

/**
 * Builds a fresh McpServer for a single request, scoped to that request's
 * tenant + API-key permissions. Created per-request (stateless transport, no
 * session reuse) so tool handlers can safely close over `ctx` without any
 * risk of one tenant's context leaking into another's connection.
 */
export function createMcpServer(ctx: McpToolContext): McpServer {
  const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });
  registerTools(server, ctx);
  return server;
}
