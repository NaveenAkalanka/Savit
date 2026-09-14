export interface Config {
  port: number;
  host: string;
  staticDir?: string;
  tursoUrl: string;
  tursoAuthToken?: string;
}

function findFlag(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  if (idx === -1) return undefined;
  return argv[idx + 1];
}

export function loadConfig(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(findFlag(argv, '--port') ?? env.SAVIT_PORT ?? 4318);
  const host = findFlag(argv, '--host') ?? env.SAVIT_HOST ?? '127.0.0.1';
  const staticDir = env.SAVIT_STATIC_DIR || undefined;

  const tursoUrl = env.TURSO_DATABASE_URL;
  if (!tursoUrl) {
    throw new Error('TURSO_DATABASE_URL is required');
  }

  return {
    port,
    host,
    staticDir,
    tursoUrl,
    tursoAuthToken: env.TURSO_AUTH_TOKEN,
  };
}
