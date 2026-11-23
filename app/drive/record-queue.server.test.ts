import * as assert from 'remix/assert'
import { sql } from 'remix/data-table'
import { describe, it } from 'remix/test'

import { createIssueStore } from '../data/issues.server.ts'
import {
  connectDriveAccount,
  createTestApp,
  seedArticle,
  seedBatch,
  seedIssue,
  TEST_DRIVE_ACCOUNT,
  TEST_REGISTRY,
  TEST_REGISTRY_OLD_ROWS,
  type TestApp,
} from '../test-app.server.ts'
import { drainRecordQueue } from './record-queue.server.ts'

async function pendingMarks(app: TestApp): Promise<number> {
  let result = await app.database.exec(sql`SELECT count(*) AS n FROM record_marks`)
  return Number(result.rows?.[0]?.['n'])
}

/** Passes until nothing is left to write, as the timer would run them. */
async function drain(app: TestApp): Promise<void> {
  for (let pass = 0; pass < 3; pass += 1) await drainRecordQueue(app.record)
}

function sheetCalls(app: TestApp): string[] {
  return app.drive.calls.filter((call) => call.includes('/v4/spreadsheets'))
}

describe('the record queue', () => {
  it('tries nothing while the account is not connected, and loses nothing', async () => {
    let app = await createTestApp()
    try {
      await seedIssue(app)
      await drainRecordQueue(app.record)

      assert.deepEqual(sheetCalls(app), [])
      assert.ok((await pendingMarks(app)) > 0)

      await connectDriveAccount(app)
      await drain(app)
      assert.equal(await pendingMarks(app), 0)
    } finally {
      await app.close()
    }
  })

  it('creates the Evidence in the issue folder and writes the issue into the app’s own list', async () => {
    let app = await createTestApp()
    try {
      await connectDriveAccount(app)
      let issueId = await seedIssue(app, 'VDM_2026_7')
      await drain(app)

      let issue = await createIssueStore(app.database).findById(issueId)
      let evidenceId = issue?.evidenceSpreadsheetId ?? ''
      let evidence = app.drive.files().find((file) => file.id === evidenceId)
      assert.equal(evidence?.parentId, 'f-VDM_2026_7')
      assert.deepEqual(
        app.drive.spreadsheet(evidenceId)?.lists.map((list) => list.title),
        ['Články', 'Redakční doložky', 'Obrazová díla'],
      )

      let [old, ours] = app.drive.spreadsheet(TEST_REGISTRY)?.lists ?? []
      assert.deepEqual(old?.cells, TEST_REGISTRY_OLD_ROWS)
      assert.equal(ours?.title, 'Vydání z aplikace')
      assert.deepEqual(
        ours?.protections.map((protection) => protection.users),
        [[TEST_DRIVE_ACCOUNT]],
      )
      assert.deepEqual(ours?.cells[1]?.slice(0, 4), [
        'VDM_2026_7',
        'f-VDM_2026_7',
        evidenceId,
        true,
      ])
      assert.equal(await pendingMarks(app), 0)
    } finally {
      await app.close()
    }
  })

  it('writes the issue’s articles and artworks into its Evidence', async () => {
    let app = await createTestApp()
    try {
      await connectDriveAccount(app)
      let issueId = await seedIssue(app)
      let article = await seedArticle(app, issueId, 'Školní jídelna po roce')
      await seedBatch(app, article, issueId, { count: 2, isSent: true })
      await drain(app)

      let issue = await createIssueStore(app.database).findById(issueId)
      let [articles, , artworks] =
        app.drive.spreadsheet(issue?.evidenceSpreadsheetId ?? '')?.lists ?? []
      assert.equal(articles?.cells.length, 2)
      assert.deepEqual(articles?.cells[1]?.slice(0, 5), [
        'Školní jídelna po roce',
        `https://docs.google.com/document/d/${article.docId}/edit`,
        article.docId,
        'Tereza Vlková',
        'Rozpracováno',
      ])
      assert.equal(artworks?.cells.length, 3)
      assert.equal(artworks?.cells[1]?.[7], 'Čeká na odpověď')
    } finally {
      await app.close()
    }
  })

  it('clears Aktivní once the issue is closed, and ticks it again once it is reopened', async () => {
    let app = await createTestApp()
    try {
      await connectDriveAccount(app)
      let issueId = await seedIssue(app, 'VDM_2026_7')
      await drain(app)
      let issues = createIssueStore(app.database)
      let active = () => app.drive.spreadsheet(TEST_REGISTRY)?.lists[1]?.cells[1]?.[3]

      await issues.close(issueId, Temporal.Now.instant())
      await drain(app)
      assert.equal(active(), false)

      await issues.reopen(issueId)
      await drain(app)
      assert.equal(active(), true)
    } finally {
      await app.close()
    }
  })

  it('keeps a record a failing Sheets did not take, and writes it once Sheets answers', async () => {
    let app = await createTestApp()
    try {
      await connectDriveAccount(app)
      app.drive.failStep('sheets')
      let issueId = await seedIssue(app)
      await drainRecordQueue(app.record)

      let failed = await app.database.exec(
        sql`SELECT attempts, last_error FROM record_marks WHERE kind = 'evidence'`,
      )
      assert.equal(Number(failed.rows?.[0]?.['attempts']), 1)
      assert.ok(String(failed.rows?.[0]?.['last_error']).includes('503'))

      app.drive.heal()
      let later = Temporal.Now.instant().add({ minutes: 5 })
      let queue = { ...app.record, now: () => later }
      for (let pass = 0; pass < 3; pass += 1) await drainRecordQueue(queue)

      let issue = await createIssueStore(app.database).findById(issueId)
      assert.notEqual(issue?.evidenceSpreadsheetId, null)
      assert.equal(await pendingMarks(app), 0)
    } finally {
      await app.close()
    }
  })
})
