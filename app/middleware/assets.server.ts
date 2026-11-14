import type { Middleware } from 'remix/router'

import { assetServer } from '../assets.ts'

/**
 * Serves the built client modules and the design system's files, above everything that will
 * read a session.
 *
 * A page pulls its whole module graph at once, dozens of requests in parallel, and a file has
 * no session. Put below `session()`, every one of them would read the session store and write
 * it back for nothing — billing lost its islands' hydration to exactly that race
 * (`cz.vednemesicnik.billing`, `app/middleware/assets.server.ts`).
 */
export function serveAssets(): Middleware {
  return async (context, next) => {
    // `null` for anything outside the asset server's base path, which is every page.
    return (await assetServer.fetch(context.request)) ?? next()
  }
}
