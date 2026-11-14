import * as assert from 'remix/assert'
import { sql } from 'remix/data-table'
import { describe, it } from 'remix/test'

import { migrateDatabase, openDatabase } from './database.server.ts'

describe('database', () => {
  it('turns foreign keys on', async () => {
    let { close, database } = openDatabase(':memory:')

    try {
      let result = await database.exec(sql`PRAGMA foreign_keys`)
      assert.deepEqual(result.rows, [{ foreign_keys: 1 }])
    } finally {
      await close()
    }
  })

  it('migrates into the journal remix db reads, and a second run changes nothing', async () => {
    let { close, database } = openDatabase(':memory:')

    try {
      await migrateDatabase(database)
      let first = await database.exec(sql`SELECT name FROM sqlite_master ORDER BY name`)

      await migrateDatabase(database)
      let second = await database.exec(sql`SELECT name FROM sqlite_master ORDER BY name`)

      assert.ok(first.rows?.some((row) => row.name === 'data_table_migrations'))
      assert.deepEqual(second.rows, first.rows)
    } finally {
      await close()
    }
  })
})
