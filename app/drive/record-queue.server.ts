import type { ArticleStore } from '../data/articles.server.ts'
import type { ArtworkStore } from '../data/artworks.server.ts'
import type { IssueStore } from '../data/issues.server.ts'
import type { RecordMark, RecordStore } from '../data/record.server.ts'
import {
  ARTICLES_LIST,
  articleRows,
  ARTWORKS_LIST,
  artworkRows,
  CLAUSES_LIST,
  clauseRows,
  EVIDENCE_LISTS,
  RECORDS_PER_PASS,
  REGISTRY_LIST,
  registryRows,
} from '../domain/record.ts'
import type { DriveAccessToken } from './access-token.server.ts'
import { logDriveFailure } from './log.server.ts'
import { createLock } from './one-at-a-time.server.ts'
import type { RecordSheets, SheetsResult } from './sheets.server.ts'

/**
 * The record queue (#111): after an action is committed, the Registr and the issue's Evidence
 * follow it, written by `publikace.app@` from the marks the database's triggers left. A sheet
 * that does not answer only delays the record, and no action waits for it or fails with it: the
 * record has no failure state on any screen (`00d`), so a write that keeps failing is a line in
 * the log and nothing else.
 */

export type RecordQueue = {
  articles: Pick<ArticleStore, 'listClausesForRecord' | 'listCreated'>
  artworks: Pick<ArtworkStore, 'listByIssue'>
  issues: Pick<IssueStore, 'findById' | 'setEvidence'>
  marks: RecordStore
  now: () => Temporal.Instant
  /** The app's origin, for the link to new articles in the Registr. */
  origin: string
  /** The Registr spreadsheet; empty skips it, as a laptop without a test Registr does. */
  registryId: string
  sheets: (accessToken: string) => RecordSheets
  token: () => Promise<DriveAccessToken>
}

/**
 * What a queue keeps between passes: its lock, and the spreadsheets whose lists it looked at
 * since the last daily rewrite. Looking costs a call, so it is done once a day per spreadsheet,
 * and again after a write of it failed: that is when a list's protection, taken off by hand, is
 * put back.
 */
type PassState = {
  hasSaidNoRegistry: boolean
  laidOut: Set<string>
  lock: ReturnType<typeof createLock>
}

const states = new WeakMap<RecordQueue, PassState>()

function stateOf(queue: RecordQueue): PassState {
  let state = states.get(queue)
  if (state === undefined) {
    state = { hasSaidNoRegistry: false, laidOut: new Set(), lock: createLock() }
    states.set(queue, state)
  }
  return state
}

async function writeEvidence(
  queue: RecordQueue,
  sheets: RecordSheets,
  issueId: number,
): Promise<SheetsResult> {
  let issue = await queue.issues.findById(issueId)
  let folderId = issue?.folderIds.issue ?? null
  if (issue === null || issue.completedAt === null || folderId === null) return { ok: true }

  let { laidOut } = stateOf(queue)
  let spreadsheetId = issue.evidenceSpreadsheetId
  if (spreadsheetId === null) {
    let found = await sheets.findOrCreateEvidence(folderId, issueId)
    if (!found.ok) return found
    let made = await sheets.layOut(found.id, EVIDENCE_LISTS, { isOwn: true })
    if (!made.ok) return made
    laidOut.add(found.id)
    /* Stored only once it is laid out, so a write that stopped halfway lays it out again. The
       ID marks the Registr, whose row then names it. */
    await queue.issues.setEvidence(issueId, found.id)
    spreadsheetId = found.id
  } else if (!laidOut.has(spreadsheetId)) {
    let checked = await sheets.layOut(spreadsheetId, EVIDENCE_LISTS, { isOwn: true })
    if (!checked.ok) return checked
    laidOut.add(spreadsheetId)
  }

  let articles = await queue.articles.listCreated(issueId)
  let byId = new Map(articles.map((article) => [article.id, article]))
  let clauses = await queue.articles.listClausesForRecord(issueId)
  let batches = (await queue.artworks.listByIssue(issueId)).flatMap((batch) => {
    let article = byId.get(batch.articleId)
    if (article === undefined) return []
    return [
      {
        ...batch,
        articleFolderId: article.folderId,
        artworks: batch.artworks.filter((artwork) => artwork.removedAt === null),
        licencesFolderId: article.licencesFolderId,
      },
    ]
  })

  let written = await sheets.write(spreadsheetId, [
    { layout: ARTICLES_LIST, rows: articleRows(articles) },
    { layout: CLAUSES_LIST, rows: clauseRows(clauses) },
    { layout: ARTWORKS_LIST, rows: artworkRows(batches) },
  ])
  if (!written.ok) laidOut.delete(spreadsheetId)
  return written
}

async function writeRegistry(queue: RecordQueue, sheets: RecordSheets): Promise<SheetsResult> {
  let state = stateOf(queue)
  if (queue.registryId === '') {
    if (!state.hasSaidNoRegistry) {
      console.info('[record] REGISTRY_SPREADSHEET_ID is empty: the Registr is not written.')
      state.hasSaidNoRegistry = true
    }
    return { ok: true }
  }
  if (!state.laidOut.has(queue.registryId)) {
    let checked = await sheets.layOut(queue.registryId, [REGISTRY_LIST])
    if (!checked.ok) return checked
    state.laidOut.add(queue.registryId)
  }
  let rows = registryRows(await queue.marks.registryIssues(), queue.origin)
  let written = await sheets.write(queue.registryId, [{ layout: REGISTRY_LIST, rows }])
  if (!written.ok) state.laidOut.delete(queue.registryId)
  return written
}

function describeMark(mark: RecordMark): string {
  return mark.kind === 'registry' ? 'the Registr' : `the Evidence of issue ${mark.issueId}`
}

/**
 * One pass: the daily rewrite when it is due, then the marks whose time has come. Nothing is
 * tried while the account is not connected (`14g`): the marks wait, and the pass after it is
 * connected again writes them. One pass at a time, whoever starts it.
 */
export async function drainRecordQueue(queue: RecordQueue): Promise<void> {
  await stateOf(queue).lock.ifFree('record', async () => {
    let token = await queue.token()
    if (!token.ok) return
    let sheets = queue.sheets(token.accessToken)

    if (await queue.marks.markAllIfDue(queue.now())) stateOf(queue).laidOut.clear()
    for (let mark of await queue.marks.takeDue(queue.now(), RECORDS_PER_PASS)) {
      let result =
        mark.kind === 'registry'
          ? await writeRegistry(queue, sheets)
          : await writeEvidence(queue, sheets, mark.issueId)
      if (result.ok) {
        await queue.marks.markWritten(mark)
      } else {
        logDriveFailure(`${describeMark(mark)} was not written`, result.error)
        await queue.marks.markFailed(mark, queue.now(), result.error)
      }
    }
  })
}

/**
 * Runs a pass now and every `intervalMs` after, without keeping the process alive. `server.ts`
 * starts it once the port is open; the suite calls `drainRecordQueue` itself.
 */
export function startRecordQueue(queue: RecordQueue, intervalMs = 30_000): { stop(): void } {
  let run = () => {
    drainRecordQueue(queue).catch((error: unknown) => {
      console.error('[record] a pass of the record queue failed:', error)
    })
  }
  run()
  let timer = setInterval(run, intervalMs)
  timer.unref()
  return { stop: () => clearInterval(timer) }
}
