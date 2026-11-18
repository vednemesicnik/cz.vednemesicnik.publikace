import type { Database } from 'remix/data-table'
import { sql } from 'remix/data-table'

import { stamp } from '../domain/time.ts'

/**
 * The e-mails public pages started and the editors resent, one row per recipient, for the cap of
 * the whole app (`02a`, _Ochrana_): the welcome e-mails of a new article and the consent requests.
 * It counts what the app asked the Mailer for, sent or not, since a request the Mailer never
 * confirmed may still have gone.
 */
export type PublicMailKind = 'consent' | 'welcome'

export type PublicMailLog = {
  /** E-mails started since a moment. */
  countSince(since: Temporal.Instant): Promise<number>
  record(kind: PublicMailKind, count: number, at: Temporal.Instant): Promise<void>
}

export function createPublicMailLog(database: Database): PublicMailLog {
  return {
    async countSince(since) {
      let result = await database.exec(
        sql`SELECT count(*) AS count FROM public_mail_log WHERE sent_at >= ${stamp(since)}`,
      )
      return Number(result.rows?.[0]?.['count'] ?? 0)
    },

    async record(kind, count, at) {
      for (let index = 0; index < count; index += 1) {
        await database.exec(
          sql`INSERT INTO public_mail_log (kind, sent_at) VALUES (${kind}, ${stamp(at)})`,
        )
      }
    },
  }
}
