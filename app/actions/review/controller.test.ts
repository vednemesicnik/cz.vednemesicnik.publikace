import * as assert from 'remix/assert'
import { sql } from 'remix/data-table'
import { describe, it } from 'remix/test'

import { createArtworkStore } from '../../data/artworks.server.ts'
import type { BatchRow } from '../../data/artworks.server.ts'
import { createJobRunStore } from '../../data/job-runs.server.ts'
import { REPLY_CHECK_JOB, type ReportedArchive } from '../../domain/reply-check.ts'
import {
  createTestApp,
  seedArticle,
  seedBatch,
  seedIssue,
  type TestApp,
} from '../../test-app.server.ts'

const MARIE = 'marie@vednemesicnik.test'
const RECEIVED = Temporal.Instant.from('2026-11-14T06:12:00Z')

/** What a run of the reply check leaves behind: a reported reply, and an archive if any. */
async function replyTo(
  app: TestApp,
  batch: BatchRow,
  text: string,
  options: { archive?: ReportedArchive; isExact?: boolean } = {},
) {
  let store = createArtworkStore(app.database)
  let runKey = crypto.randomUUID()
  let at = Temporal.Now.instant()
  await createJobRunStore(app.database).start({
    at,
    intervalMinutes: 30,
    job: REPLY_CHECK_JOB,
    runKey,
  })
  await app.database.exec(sql`UPDATE artwork_batches SET claimed_at = NULL`)
  await store.claimForReplyCheck(runKey, at)
  return store.recordReport(
    runKey,
    batch.id,
    {
      archive: options.archive ?? null,
      reply: { messageId: `m-${crypto.randomUUID()}`, receivedAt: RECEIVED, text, threadId: 't-1' },
      state: options.isExact === true ? 'reply_matches' : 'other_reply',
    },
    at,
  )
}

async function setup() {
  let app = await createTestApp()
  await app.directory.seedInitialAdmin(MARIE, Temporal.Now.instant())
  let browser = app.browser()
  await browser.signInAs(MARIE, 'Marie Horáková')
  let issueId = await seedIssue(app, 'VDM_2026_5')
  let article = await seedArticle(app, issueId, 'Ilustrace k tématu Volby')
  let batch = await seedBatch(app, article, issueId)
  return { app, article, batch, browser, issueId, store: createArtworkStore(app.database) }
}

describe('Ke kontrole', () => {
  it('says there is nothing to decide, and that the job never reported', async () => {
    let { app, browser } = await setup()
    try {
      let html = await (await browser.get('/review')).text()
      assert.match(html, /Nic ke kontrole/)
      assert.match(html, /Úloha Odpovědi k obrazovým dílům se zatím neohlásila\./)
      assert.match(html, /href="\/review"[^>]*>\s*Ke kontrole\s*</)
    } finally {
      await app.close()
    }
  })

  it('shows a reply with who sent it, when, and its own text, and counts it in the panel', async () => {
    let { app, batch, browser } = await setup()
    try {
      await replyTo(app, batch, 'Můžu se zeptat, kde přesně fotka vyjde?')
      let html = await (await browser.get('/review')).text()
      assert.match(html, /Obrazová díla · 2 díla · VDM_2026_5/)
      assert.match(html, /Klára Šimková · klara\.simkova@external\.test · přijato 14\. 11\. v 7:12/)
      assert.match(
        html,
        /<blockquote class="vdm-queue-item__quote">Můžu se zeptat, kde přesně fotka vyjde\?<\/blockquote>/,
      )
      assert.match(html, /Další akce pro odpověď \(Klára Šimková\)/)
      assert.match(html, />Ke kontrole<span[^>]*>1<\/span>/)
      assert.match(html, /Odpovědi čteny ve? \d+:\d\d/)

      let detail = await (await browser.get('/issues/VDM_2026_5')).text()
      assert.match(detail, /odpověď „Můžu se zeptat, kde přesně fotka vyjde\?“/)
    } finally {
      await app.close()
    }
  })

  it('records Je to souhlas, keeps the card for one load with Vrátit, and takes it back', async () => {
    let { app, batch, browser, store } = await setup()
    try {
      await replyTo(app, batch, 'ok, souhlas')
      let answer = await browser.post(`/review/batches/${batch.id}/consent`, {}, '/review')
      assert.equal(answer.status, 303)
      let stored = await store.findBatch(batch.id)
      assert.equal(stored?.consentVerifiedByEmail, MARIE)
      assert.equal(stored?.consentVerifiedByName, 'Marie Horáková')

      let settled = await (await browser.get('/review')).text()
      assert.match(settled, /vdm-queue-item--settled/)
      assert.match(settled, /Klára Šimková · odpověď „ok, souhlas“/)
      assert.match(
        settled,
        /Souhlas zaznamenán\. Pokus o uložení konverzace proběhne kolem \d+:\d\d\./,
      )
      assert.match(settled, /class="vdm-toast__action"[^>]*>Vrátit</)
      assert.doesNotMatch(settled, />Ke kontrole<span/)

      let next = await (await browser.get('/review')).text()
      assert.match(next, /Nic ke kontrole/)

      await browser.post(`/review/batches/${batch.id}/consent/undo`, {}, '/review')
      assert.equal((await store.findBatch(batch.id))?.consentVerifiedAt, null)
      assert.match(await (await browser.get('/review')).text(), /ok, souhlas<\/blockquote>/)
    } finally {
      await app.close()
    }
  })

  it('tells the editors a batch is discarded, and offers no menu for it', async () => {
    let { app, batch, browser, store } = await setup()
    try {
      await store.discardBatch(batch.id, Temporal.Instant.from('2026-11-18T10:00:00Z'))
      await replyTo(app, batch, 'Souhlasím', { isExact: true })
      let html = await (await browser.get('/review')).text()
      assert.match(html, /dávka zahozena 18\. 11\./)
      assert.match(html, /Dávka je od 18\. 11\. zahozená\./)
      assert.doesNotMatch(html, /Další akce pro odpověď/)
    } finally {
      await app.close()
    }
  })

  it('brings a consent back as Chyba when its archive failed', async () => {
    let { app, batch, browser } = await setup()
    try {
      await replyTo(app, batch, 'Souhlasím', { archive: { error: 'Drive' }, isExact: true })
      let html = await (await browser.get('/review')).text()
      assert.match(html, /konverzace se neuložila/)
      assert.match(html, /Souhlas platí\. Konverzaci se nepodařilo uložit do složky Licence\./)
      assert.doesNotMatch(html, />Je to souhlas</)
    } finally {
      await app.close()
    }
  })

  it('keeps an approved batch out of the queue, with its conversation in Licence', async () => {
    let { app, batch, browser } = await setup()
    try {
      await replyTo(app, batch, 'Souhlasím', { archive: { fileId: 'pdf-1' }, isExact: true })
      assert.match(await (await browser.get('/review')).text(), /Nic ke kontrole/)
      assert.match(await (await browser.get('/issues/VDM_2026_5')).text(), /konverzace v Licencích/)
    } finally {
      await app.close()
    }
  })

  it('sends somebody not signed in to sign in', async () => {
    let { app } = await setup()
    try {
      let response = await app.browser().get('/review')
      assert.equal(response.status, 303)
    } finally {
      await app.close()
    }
  })
})
