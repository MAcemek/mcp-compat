export interface FixtureRequest {
  httpMethod: string;
  path: string;
  rpcMethod: string | null;
  id: string | number | null;
  error: number | null;
  session: string | null;
  protocolVersion: string | null;
  mcpMethod: string | null;
  authorized: boolean;
}

export interface FixtureServer {
  url: string;
  requests: FixtureRequest[];
  close(): Promise<void>;
}

export type HttpProfile = 'dual' | 'modern' | 'legacy-session' | 'sse-only';

export function startFixtureServer(
  name: HttpProfile,
  options?: { port?: number; token?: string; echoSession?: boolean },
): Promise<FixtureServer>;
