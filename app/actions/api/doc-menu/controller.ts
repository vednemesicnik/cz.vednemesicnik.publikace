import { createController } from 'remix/router'

import type { MembershipCheck } from '../../../auth/group-membership.server.ts'
import type {
  IdentityTokenVerifier,
  VerifiedIdentity,
} from '../../../auth/identity-token.server.ts'
import type { Article, ArticleStore } from '../../../data/articles.server.ts'
import type { IssueStore } from '../../../data/issues.server.ts'
import { documentUrl } from '../../../domain/article.ts'
import {
  decideProofreading,
  type DocMenuDialog,
  PROOFREADING_REFUSED_RESULT,
  type ProofreadingTarget,
  proofreadingMarkedDialog,
  refusedAccountDialog,
} from '../../../domain/doc-menu.ts'
import type { DriveAccessToken } from '../../../drive/access-token.server.ts'
import { createDocPermissions } from '../../../drive/doc-permissions.server.ts'
import { routes } from '../../../routes.ts'

/**
 * The API the article Doc's menu _Publikace_ calls (#50). A click asks twice: once for the
 * confirmation, once to record. Each call carries the clicker's Google identity token as a bearer
 * and `{ documentId, metaDocumentId }`: the Doc it was clicked in, and the `docId` of the
 * `_meta.json` beside it, which tells a copy of an article apart from a Doc the app never knew.
 *
 * It answers `{ dialog }` for the script to draw, refusals included, or 503 when Google, Drive or
 * the membership service could not be asked: the script then shows its own dialog. Nothing
 * here sets a cookie, and no answer to a caller who is refused says anything of an article.
 */

export type DocMenuDependencies = {
  articles: ArticleStore
  checkMembership: MembershipCheck
  fetch: typeof globalThis.fetch
  issues: IssueStore
  now: () => Temporal.Instant
  token: () => Promise<DriveAccessToken>
  verifyIdentityToken: IdentityTokenVerifier
}

type Call = { documentId: string; metaDocumentId: string | null }

/** Drive IDs are short; anything else is not a call from the menu. */
const MAX_ID_LENGTH = 200

function isDocumentId(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= MAX_ID_LENGTH
}

async function readCall(request: Request): Promise<Call | null> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null) return null
  let { documentId, metaDocumentId } = body as Record<string, unknown>
  if (!isDocumentId(documentId)) return null
  if (metaDocumentId !== undefined && metaDocumentId !== null && !isDocumentId(metaDocumentId)) {
    return null
  }
  return { documentId, metaDocumentId: metaDocumentId ?? null }
}

function bearerOf(request: Request): string | null {
  let match = /^Bearer (\S+)$/.exec(request.headers.get('Authorization') ?? '')
  return match?.[1] ?? null
}

function answer(dialog: DocMenuDialog): Response {
  return Response.json({ dialog }, { headers: { 'Cache-Control': 'no-store' } })
}

function unavailable(): Response {
  return Response.json(
    { error: 'unavailable' },
    { headers: { 'Cache-Control': 'no-store' }, status: 503 },
  )
}

export default function createDocMenuController(dependencies: DocMenuDependencies) {
  async function targetOf(article: Article, isCopy: boolean): Promise<ProofreadingTarget> {
    let issue = await dependencies.issues.findById(article.issueId)
    if (issue === null) return { kind: 'unknown' }
    if (isCopy) {
      return {
        articleName: article.name,
        documentUrl: documentUrl(article.docId),
        issueName: issue.name,
        kind: 'copy',
      }
    }
    return {
      articleName: article.name,
      isIssueClosed: issue.closedAt !== null,
      issueName: issue.name,
      kind: 'article',
      proofreading: article.proofreading,
    }
  }

  async function proofreading(request: Request, isConfirmed: boolean): Promise<Response> {
    let call = await readCall(request)
    if (call === null) return Response.json({ error: 'invalid_request' }, { status: 400 })

    let bearer = bearerOf(request)
    let identity =
      bearer === null
        ? { status: 'refused' as const }
        : await dependencies.verifyIdentityToken(bearer)
    if (identity.status === 'unavailable') return unavailable()
    if (identity.status === 'refused')
      return answer(refusedAccountDialog(PROOFREADING_REFUSED_RESULT))
    let account: VerifiedIdentity = identity.identity

    let article = await dependencies.articles.findCreatedByDocId(call.documentId)
    let original =
      article === null && call.metaDocumentId !== null && call.metaDocumentId !== call.documentId
        ? await dependencies.articles.findCreatedByDocId(call.metaDocumentId)
        : null

    /* The right to edit is asked of the Doc the answer is about: a copy's original, since that is
       the Doc the dialog points to, and an unknown Doc itself. */
    let drive = await dependencies.token()
    if (!drive.ok) return unavailable()
    let permissions = createDocPermissions({
      accessToken: drive.accessToken,
      checkMembership: dependencies.checkMembership,
      fetch: dependencies.fetch,
    })
    let mayEdit = await permissions.canEdit(
      article?.docId ?? original?.docId ?? call.documentId,
      account.email,
    )
    if (mayEdit === 'unavailable') return unavailable()

    let target: ProofreadingTarget =
      article !== null
        ? await targetOf(article, false)
        : original !== null
          ? await targetOf(original, true)
          : { kind: 'unknown' }
    let decision = decideProofreading({
      account: mayEdit === 'yes' ? account : null,
      isConfirmed,
      target,
    })
    if ('heading' in decision) return answer(decision)
    if (article === null) return unavailable()

    if (await dependencies.articles.markProofread(article.id, account, dependencies.now())) {
      return answer(proofreadingMarkedDialog())
    }
    /* Somebody else recorded it between the two calls: their record is the answer. */
    let current = await dependencies.articles.findCreatedByDocId(article.docId)
    if (current === null) return unavailable()
    let again = decideProofreading({ account, isConfirmed, target: await targetOf(current, false) })
    return 'heading' in again ? answer(again) : unavailable()
  }

  return createController(routes.api.docMenu, {
    actions: {
      previewProofreading(context) {
        return proofreading(context.request, false)
      },
      markProofreading(context) {
        return proofreading(context.request, true)
      },
    },
  })
}
