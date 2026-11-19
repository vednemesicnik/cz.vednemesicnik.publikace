import { createContextKey, type Middleware } from 'remix/router'

import type { ArtworkStore } from '../data/artworks.server.ts'

/**
 * How many cards _Ke kontrole_ holds, for the number beside it in the panel (`Panel.dc.html`).
 * Read with `context.get(ReviewCount)`; the panel reads it from the request it is drawn in, as
 * `CsrfField` reads its token, so no page has to pass it down.
 */
export const ReviewCount = createContextKey<number>(0)

export function loadReviewCount(artworks: ArtworkStore): Middleware<{
  key: typeof ReviewCount
  property: 'reviewCount'
  value: number
}> {
  return async (context, next) => {
    context.set(ReviewCount, await artworks.reviewCount())
    return next()
  }
}
