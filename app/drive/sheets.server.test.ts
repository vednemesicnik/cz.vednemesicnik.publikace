import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { ARTICLES_LIST, EVIDENCE_LISTS, REGISTRY_LIST } from '../domain/record.ts'
import { createFakeDrive } from './fake-drive.server.ts'
import { createRecordSheets } from './sheets.server.ts'

const EDITOR = 'publikace.app@vednemesicnik.test'

function setup() {
  let drive = createFakeDrive()
  drive.seedFolder('issue-folder', 'VDM_2026_7', 'issues')
  let sheets = createRecordSheets({ accessToken: 'token', editor: EDITOR, fetch: drive.fetch })
  return { drive, sheets }
}

describe('the record’s spreadsheets', () => {
  it('create the Evidence once in the issue folder and find the same file again', async () => {
    let { drive, sheets } = setup()
    let created = await sheets.findOrCreateEvidence('issue-folder', 7)
    let again = await sheets.findOrCreateEvidence('issue-folder', 7)

    assert.equal(created.ok, true)
    assert.deepEqual(again, created)
    let evidence = drive.files().filter((file) => file.name === 'Evidence')
    assert.equal(evidence.length, 1)
    assert.equal(evidence[0]?.parentId, 'issue-folder')
    assert.deepEqual(evidence[0]?.appProperties, { publikaceEvidence: '7' })
  })

  it('lay the Evidence out in the scripts’ lists, protected for the app alone', async () => {
    let { drive, sheets } = setup()
    let created = await sheets.findOrCreateEvidence('issue-folder', 7)
    if (!created.ok) throw new Error(created.error)

    assert.deepEqual(await sheets.layOut(created.id, EVIDENCE_LISTS, { isOwn: true }), { ok: true })
    let lists = drive.spreadsheet(created.id)?.lists ?? []
    assert.deepEqual(
      lists.map((list) => list.title),
      ['Články', 'Redakční doložky', 'Obrazová díla'],
    )
    for (let list of lists) {
      assert.deepEqual(list.editors, [EDITOR])
      assert.equal(list.frozenRows, 1)
      assert.equal(list.isHeaderStyled, true)
    }
    assert.deepEqual(lists[0]?.statusValues, ARTICLES_LIST.status?.values)
    assert.ok(lists[0]?.statusValues?.includes('Dopsáno'))
    assert.deepEqual(lists[0]?.dateColumns, ARTICLES_LIST.dateColumns)
  })

  it('lay out only what is missing, so a second time costs one look', async () => {
    let { drive, sheets } = setup()
    let created = await sheets.findOrCreateEvidence('issue-folder', 7)
    if (!created.ok) throw new Error(created.error)
    await sheets.layOut(created.id, EVIDENCE_LISTS, { isOwn: true })
    let before = drive.calls.length

    assert.deepEqual(await sheets.layOut(created.id, EVIDENCE_LISTS, { isOwn: true }), { ok: true })
    assert.deepEqual(drive.calls.slice(before), [`GET /v4/spreadsheets/${created.id}`])
  })

  it('add the app’s list to the Registr beside Vydání, which keeps every cell', async () => {
    let { drive, sheets } = setup()
    let oldRows = [
      ['Vydání', 'ID složky', 'ID tabulky', 'Aktivní'],
      ['VDM_2026_4', 'old-folder', 'old-sheet', true],
    ]
    drive.seedSpreadsheet('registry', 'Registr', [{ cells: oldRows, title: 'Vydání' }])

    assert.deepEqual(await sheets.layOut('registry', [REGISTRY_LIST]), { ok: true })
    let rows = [['VDM_2026_7', 'f', 's', true, '', 46349.5, '']]
    assert.deepEqual(await sheets.write('registry', [{ layout: REGISTRY_LIST, rows }]), {
      ok: true,
    })

    let [old, ours] = drive.spreadsheet('registry')?.lists ?? []
    assert.equal(old?.title, 'Vydání')
    assert.deepEqual(old?.cells, oldRows)
    assert.equal(old?.editors, null)
    assert.equal(ours?.title, 'Vydání z aplikace')
    assert.equal(ours?.checkboxColumn, 3)
    assert.deepEqual(ours?.cells, [[...REGISTRY_LIST.headers], ...rows])
  })

  it('write a list whole, as typed, and clear the rows a shorter record no longer has', async () => {
    let { drive, sheets } = setup()
    let created = await sheets.findOrCreateEvidence('issue-folder', 7)
    if (!created.ok) throw new Error(created.error)
    await sheets.layOut(created.id, EVIDENCE_LISTS, { isOwn: true })

    await sheets.write(created.id, [
      { layout: ARTICLES_LIST, rows: [['=Úvodník'], ['Druhý'], ['Třetí']] },
    ])
    await sheets.write(created.id, [{ layout: ARTICLES_LIST, rows: [['=Úvodník']] }])

    let articles = drive.spreadsheet(created.id)?.lists[0]
    assert.deepEqual(articles?.cells, [[...ARTICLES_LIST.headers], ['=Úvodník']])
  })

  it('answer a failure without throwing, so the queue can try again later', async () => {
    let { drive, sheets } = setup()
    drive.failStep('sheets')
    let created = await sheets.findOrCreateEvidence('issue-folder', 7)
    assert.equal(created.ok, false)

    drive.heal()
    drive.goDown()
    let result = await sheets.write('missing', [{ layout: ARTICLES_LIST, rows: [] }])
    assert.equal(result.ok, false)
  })
})
