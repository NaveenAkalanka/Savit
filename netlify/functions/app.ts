// Netlify's entry point for the whole app (API + SSR pages). Everything not
// matched by a static-asset redirect in netlify.toml lands here — see that
// file for which paths bypass this function and go straight to the CDN.
//
// The Fastify app itself (server/src/app.ts) is untouched — this file only
// wires it up for a serverless runtime: no app.listen(), request handling
// goes through @fastify/aws-lambda's inject()-based adapter instead, and the
// static/SSR asset paths are pointed at the client build that netlify.toml's
// `included_files` bundles alongside this function (see server/src/ssr.ts,
// which already knows how to serve from a `staticDir` in production mode —
// nothing there needed to change either).
import path from 'node:path';
import awsLambdaFastify from '@fastify/aws-lambda';
import { loadConfig } from '../../server/src/config.ts';
import { createDb, initSchema } from '../../server/src/db.ts';
import { buildApp } from '../../server/src/app.ts';

type LambdaHandler = (event: unknown, context: unknown, callback?: unknown) => unknown;

// Lazily built on first invocation and cached on the module for the life of
// this function instance (reused across warm invocations) — no top-level
// await, so this bundles cleanly to CommonJS, which is what keeps
// @fastify/aws-lambda's own CJS internals (require('node:crypto') etc.)
// working without an ESM interop shim getting in the way.
let handlerPromise: Promise<LambdaHandler> | undefined;

async function init(): Promise<LambdaHandler> {
  // included_files preserves each file's repo-relative path under the
  // function's own working directory, so this mirrors that same path.
  process.env.SAVIT_STATIC_DIR ??= path.join(process.cwd(), 'client/dist/client');

  const config = loadConfig([], process.env);
  const db = createDb(config);
  await initSchema(db);
  const app = await buildApp(config, db);
  return awsLambdaFastify(app) as LambdaHandler;
}

const handler: LambdaHandler = async (event, context, callback) => {
  handlerPromise ??= init();
  const actual = await handlerPromise;
  return actual(event, context, callback);
};

export { handler };
