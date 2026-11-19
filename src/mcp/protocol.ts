import { AppError } from '../domain/errors.js';
import type { User } from '../domain/types.js';
import type { Tool } from './tools.js';

/**
 * The MCP protocol loop, written by hand (from Exercise 1): JSON-RPC 2.0
 * messages, one per line on stdin/stdout. This file only knows the protocol;
 * what the tools do is in tools.ts.
 */

export const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

interface Request {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpDeps {
  tools: Tool[];
  /** Resolves the one user this server acts as, from the ordinary session token. */
  resolveUser: () => Promise<User | null>;
  log?: (message: string) => void;
}

const error = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const result = (id: unknown, value: unknown) => ({ jsonrpc: '2.0', id, result: value });
const text = (value: string, isError = false) => ({ content: [{ type: 'text', text: value }], isError });

/** Handles one parsed message. Returns the response, or null for a notification. */
export async function handleMessage(message: unknown, deps: McpDeps): Promise<object | null> {
  if (typeof message !== 'object' || message === null || (message as Request).jsonrpc !== '2.0' || typeof (message as Request).method !== 'string') {
    return error((message as Request | null)?.id, -32600, 'Invalid Request');
  }
  const { id, method, params = {} } = message as Request;
  // A message without an id is a notification (e.g. notifications/initialized): no reply.
  if (id === undefined) return null;

  switch (method) {
    case 'initialize': {
      const requested = String(params.protocolVersion ?? '');
      return result(id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'lab-booking', version: '1.0.0' },
      });
    }
    case 'ping':
      return result(id, {});
    case 'tools/list':
      return result(id, {
        tools: deps.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
    case 'tools/call': {
      const tool = deps.tools.find((t) => t.name === params.name);
      if (!tool) return error(id, -32602, `Unknown tool: ${String(params.name)}`);
      const user = await deps.resolveUser();
      if (!user) {
        return result(id, text('Session token is missing or expired. Set LAB_SESSION_TOKEN to a token from the app.', true));
      }
      const args = typeof params.arguments === 'object' && params.arguments !== null ? (params.arguments as Record<string, unknown>) : {};
      try {
        return result(id, text(JSON.stringify(await tool.run(args, user), null, 2)));
      } catch (caught) {
        // A refused rule (403, 409…) is a normal answer the agent should read, not a protocol error.
        if (caught instanceof AppError) return result(id, text(caught.message, true));
        deps.log?.(`tool ${tool.name} failed: ${(caught as Error).message}`);
        return result(id, text('The tool failed unexpectedly.', true));
      }
    }
    default:
      return error(id, -32601, `Method not found: ${method}`);
  }
}

/** Parses one line of input and handles it; invalid JSON gets a parse error. */
export async function handleLine(line: string, deps: McpDeps): Promise<object | null> {
  if (!line.trim()) return null;
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return error(null, -32700, 'Parse error');
  }
  return handleMessage(message, deps);
}
