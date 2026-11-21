import { createHash, randomUUID } from 'node:crypto'

import type { CancelFinalOutcome, FinalVersionOutcome } from '../data/articles.server.ts'
import type { ArtworksSetup } from './artworks-setup.server.ts'
import { logDriveFailure } from './log.server.ts'
import { createLock } from './one-at-a-time.server.ts'

/**
 * _Označit finální verzi_ and its cancel on Drive (`15f`, `15g`, #88): the article's Doc as it is,
 * exported to PDF and stored as `<sha256>.pdf` in the article folder, as `mark-for-finalization.gs`
 * does for the issues made before the app. The database is written only once the PDF exists, and
 * the PDF goes to the bin when the database refuses it: all or nothing (`11c`).
 *
 * The PDF is never reused by its hash. An export of the same Doc rarely gives the same bytes, and
 * a cancel would otherwise bin a file an earlier marking still points to.
 */

export type FinalVersionSetup = Pick<ArtworksSetup, 'articles' | 'files' | 'now' | 'token'>

/**
 * What marking came to. `done` is recorded; the rest wrote nothing and say why: the database
 * refused (somebody changed the article meanwhile), the account is not connected, the article
 * folder or the Doc is gone, or Drive did not answer.
 */
export type MarkFinalOutcome =
  | { at: Temporal.Instant; kind: 'done' }
  | { kind: 'refused'; refusal: Exclude<FinalVersionOutcome, { kind: 'done' }> }
  | { kind: 'account' }
  | { kind: 'doc-missing' }
  | { kind: 'folder-missing' }
  | { kind: 'unavailable' }

export type CancelFinalStepOutcome =
  | { kind: 'done' }
  | { kind: 'refused'; refusal: Exclude<CancelFinalOutcome, { kind: 'done' }> }
  | { kind: 'unavailable' }

const lock = createLock()

export function markFinalVersion(
  setup: FinalVersionSetup,
  input: {
    by: { email: string; name: string | null }
    id: number
    owner?: string
    takenAt: Temporal.Instant
  },
): Promise<MarkFinalOutcome> {
  return lock(`final-version:${input.id}`, () => mark(setup, input))
}

async function mark(
  setup: FinalVersionSetup,
  input: Parameters<typeof markFinalVersion>[1],
): Promise<MarkFinalOutcome> {
  let refusal = await setup.articles.checkFinalVersion(input.id, input.takenAt, input.owner)
  if (refusal !== null) return { kind: 'refused', refusal }
  let article = await setup.articles.findById(input.id)
  if (article === null || article.docId === null || article.folderId === null) {
    return { kind: 'refused', refusal: { kind: 'gone' } }
  }
  if (article.missing.article !== null) return { kind: 'folder-missing' }

  let token = await setup.token()
  if (!token.ok)
    return token.reason === 'unavailable' ? { kind: 'unavailable' } : { kind: 'account' }
  let files = setup.files(token.accessToken)

  /* Gone is told apart from a Drive that does not answer, so the Callout says what to restore. */
  let folder = await files.placeOf(article.folderId)
  if (folder.kind === 'unavailable') return { kind: 'unavailable' }
  if (folder.kind === 'gone') {
    await setup.articles.markMissing(input.id, ['article'], setup.now())
    return { kind: 'folder-missing' }
  }
  let doc = await files.placeOf(article.docId)
  if (doc.kind === 'unavailable') return { kind: 'unavailable' }
  if (doc.kind === 'gone') return { kind: 'doc-missing' }

  let pdf = await files.exportPdf(article.docId)
  if (pdf === null) return { kind: 'unavailable' }
  let hash = createHash('sha256').update(pdf).digest('hex')
  let attemptKey = `final-version:${input.id}:${randomUUID()}`
  let stored = await files.upload(
    article.folderId,
    `${hash}.pdf`,
    'application/pdf',
    pdf,
    attemptKey,
  )
  if (!stored.ok) {
    await binAttempt(setup, article.folderId, attemptKey, null)
    return { kind: 'unavailable' }
  }

  let outcome = await setup.articles.markFinalVersion({
    at: setup.now(),
    by: input.by,
    id: input.id,
    owner: input.owner,
    pdf: { attemptKey, fileId: stored.id, hash },
    takenAt: input.takenAt,
  })
  if (outcome.kind === 'done') return outcome
  await binAttempt(setup, article.folderId, attemptKey, stored.id)
  return { kind: 'refused', refusal: outcome }
}

/**
 * Puts a marking's PDF in the bin, by its ID and by the attempt's tag, which covers an upload whose
 * answer was lost on the way. A PDF that does not reach the bin is no harm: no record points to it.
 */
async function binAttempt(
  setup: FinalVersionSetup,
  folderId: string,
  attemptKey: string,
  fileId: string | null,
): Promise<void> {
  let token = await setup.token()
  if (!token.ok) return
  let files = setup.files(token.accessToken)
  let ids = new Set(fileId === null ? [] : [fileId])
  for (let id of (await files.findTagged(folderId, attemptKey)) ?? []) ids.add(id)
  for (let id of ids) {
    if (!(await files.trash(id)))
      logDriveFailure('a final version PDF was not moved to the bin', id)
  }
}

/**
 * _Zrušit finální verzi_ (`15g`): the PDF to the bin first, then the record, so a cancel Drive
 * stops leaves the marking whole and the toast says to try again. When the record refuses after
 * all, because a run took a clause in between, the PDF comes back out of the bin, as a discard
 * Drive stopped does (`12o`).
 */
export function cancelFinalVersion(
  setup: FinalVersionSetup,
  input: { id: number; markedAt: Temporal.Instant; owner?: string },
): Promise<CancelFinalStepOutcome> {
  return lock(`final-version:${input.id}`, () => cancel(setup, input))
}

async function cancel(
  setup: FinalVersionSetup,
  input: Parameters<typeof cancelFinalVersion>[1],
): Promise<CancelFinalStepOutcome> {
  let refusal = await setup.articles.checkCancelFinal(input.id, input.markedAt, input.owner)
  if (refusal !== null) return { kind: 'refused', refusal }
  let article = await setup.articles.findById(input.id)
  let pdfFileId = article?.finalVersion?.pdfFileId ?? null
  if (pdfFileId === null) return { kind: 'refused', refusal: { kind: 'not-final' } }

  let token = await setup.token()
  if (!token.ok) return { kind: 'unavailable' }
  let files = setup.files(token.accessToken)
  if (!(await files.trash(pdfFileId))) return { kind: 'unavailable' }

  let outcome = await setup.articles.cancelFinalVersion(
    input.id,
    setup.now(),
    input.markedAt,
    input.owner,
  )
  if (outcome.kind === 'done') return { kind: 'done' }
  if (!(await files.restore(pdfFileId))) {
    logDriveFailure('a final version PDF was not taken back out of the bin', pdfFileId)
  }
  return { kind: 'refused', refusal: outcome }
}
