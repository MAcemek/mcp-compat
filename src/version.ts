/** Keep in sync with "version" in package.json (a test checks this). */
export const VERSION = '0.1.0';

export const HOMEPAGE = 'https://github.com/MAcemek/mcp-compat';

/** Sent as clientInfo in initialize and as io.modelcontextprotocol/clientInfo in _meta. */
export const CLIENT_INFO = { name: 'mcp-compat', version: VERSION } as const;
