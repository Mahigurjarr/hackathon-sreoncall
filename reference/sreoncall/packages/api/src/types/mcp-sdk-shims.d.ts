/**
 * Hand-authored type shims for @modelcontextprotocol/sdk's deep-import subpaths
 * (e.g. '@modelcontextprotocol/sdk/server/mcp.js'). The package ships ESM-only
 * with a CJS build reachable only through its package.json `exports` map —
 * Node's own require() resolves that fine at runtime, but this project's
 * tsconfig uses classic ("node") module resolution (module: commonjs, no
 * moduleResolution override), which predates and does not understand
 * conditional `exports` maps, so `import ... from '@modelcontextprotocol/sdk/server/mcp.js'`
 * fails to type-check even though it works at runtime.
 *
 * Switching the whole package to `moduleResolution: node16`/`bundler` was
 * tried and reverted — it breaks dozens of unrelated existing files across
 * the codebase (relative imports needing explicit extensions, several
 * ESM-only third-party deps hitting the same require/ESM mismatch elsewhere).
 * Ambient module declarations sidestep the problem entirely: TypeScript
 * matches them by literal specifier string and never tries to resolve the
 * real package for typing purposes, so this file only needs to describe the
 * slice of the SDK's API this codebase actually calls.
 */

declare module '@modelcontextprotocol/sdk/server/mcp.js' {
  export interface McpServerInfo {
    name: string;
    version: string;
  }

  export interface McpServerOptions {
    capabilities?: Record<string, unknown>;
  }

  export interface McpToolTextContent {
    type: 'text';
    text: string;
  }

  export interface McpToolResult {
    content: McpToolTextContent[];
    isError?: boolean;
  }

  export interface McpToolConfig {
    title?: string;
    description?: string;
    /** A Zod raw shape (Record<string, ZodType>) describing the tool's input. */
    inputSchema?: Record<string, unknown>;
  }

  export type McpToolCallback = (
    args: Record<string, unknown>,
    extra: Record<string, unknown>,
  ) => Promise<McpToolResult> | McpToolResult;

  export class McpServer {
    constructor(serverInfo: McpServerInfo, options?: McpServerOptions);
    registerTool(name: string, config: McpToolConfig, cb: McpToolCallback): unknown;
    connect(transport: unknown): Promise<void>;
    close(): Promise<void>;
  }
}

declare module '@modelcontextprotocol/sdk/server/streamableHttp.js' {
  import { IncomingMessage, ServerResponse } from 'node:http';

  export interface StreamableHTTPServerTransportOptions {
    /** Pass `undefined` for stateless mode — no session ID is generated or required, each request authenticates independently. */
    sessionIdGenerator?: (() => string) | undefined;
  }

  export class StreamableHTTPServerTransport {
    constructor(options?: StreamableHTTPServerTransportOptions);
    handleRequest(req: IncomingMessage, res: ServerResponse, parsedBody?: unknown): Promise<void>;
    close(): Promise<void>;
  }
}
