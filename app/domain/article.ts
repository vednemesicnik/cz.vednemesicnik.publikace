/**
 * Articles (_články_): the rules the form _Nový článek_ follows (`20a`, `20b`), the record the
 * Doc's scripts read, and the words `20a`–`20d` and the welcome e-mail give it.
 *
 * Pure, and imported by the browser too: the form checks the same rules before it is sent as the
 * server checks after (`20b`).
 */

export const MAX_ARTICLE_NAME_LENGTH = 200
export const MAX_AUTHORS = 10

/** What the form sent for one author card. */
export type AuthorInput = { email: string; name: string }

export type ArticleInput = { authors: readonly AuthorInput[]; name: string }

/** An author as the article keeps them: the name is also the signature, as in the script. */
export type Author = { email: string; name: string }

/**
 * Where an error belongs: `name`, a card's `name` or `email` by its 1-based number, or the group
 * of authors. The summary on top lists them in this order (`20b`).
 */
export type FieldKey = 'authors' | 'name' | `author-${number}-email` | `author-${number}-name`

export type FieldError = { key: FieldKey; message: string }

export type ArticleCheck =
  | { article: { authors: Author[]; name: string }; ok: true }
  | { authors: AuthorInput[]; errors: FieldError[]; ok: false }

/* `20b`, as the copywriter settled them (il3qqrj9). */
export const EMPTY_ARTICLE_NAME_MESSAGE = 'Vyplňte název článku.'
export const LONG_ARTICLE_NAME_MESSAGE = 'Zkraťte název na nejvýš 200 znaků.'
export const EMPTY_AUTHOR_NAME_MESSAGE = 'Vyplňte jméno a příjmení.'
export const EMPTY_AUTHOR_EMAIL_MESSAGE = 'Vyplňte e-mail autora.'
export const MISSING_AT_MESSAGE = 'Doplňte do e-mailové adresy zavináč.'
export const INVALID_EMAIL_MESSAGE = 'Zadejte e-mail ve tvaru jan.novak@external.test.'
export const AUTHOR_LIMIT_NOTE = 'Článek může mít nejvýš 10 autorů.'

export function duplicateEmailMessage(firstAuthor: number): string {
  return `Zkontrolujte adresu. Stejnou má i autor ${firstAuthor}.`
}

/** `Opravte 1 pole`, `Opravte 2 pole`, `Opravte 5 polí`. */
export function summaryTitle(count: number): string {
  return `Opravte ${count} ${count >= 5 || count === 0 ? 'polí' : 'pole'}`
}

/** The script's own shape check: the Mailer refuses what this lets through anyway. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function emailMessage(email: string): string | null {
  if (email === '') return EMPTY_AUTHOR_EMAIL_MESSAGE
  if (!email.includes('@')) return MISSING_AT_MESSAGE
  if (!EMAIL_SHAPE.test(email) || email.length > 254) return INVALID_EMAIL_MESSAGE
  return null
}

/**
 * The form's rules, the same in the browser and on the server (`20b`).
 *
 * A card left wholly empty is dropped without an error, as the script drops it: an extra card
 * somebody added and did not fill is not a mistake to correct. A card with one of its two fields
 * filled gets the missing one's sentence. At least one author is required, so an empty form keeps
 * its first card and both of its errors. More than ten cannot come from the page, which hides
 * _Přidat autora_ at the tenth; a request with more is refused on the group.
 */
export function checkArticle(input: ArticleInput): ArticleCheck {
  let name = input.name.normalize('NFC').trim()
  let cards = input.authors
    .map((author) => ({
      email: author.email.normalize('NFC').trim(),
      name: author.name.normalize('NFC').trim(),
    }))
    .filter((author) => author.name !== '' || author.email !== '')
  if (cards.length === 0) cards = [{ email: '', name: '' }]

  let errors: FieldError[] = []
  if (name === '') errors.push({ key: 'name', message: EMPTY_ARTICLE_NAME_MESSAGE })
  else if ([...name].length > MAX_ARTICLE_NAME_LENGTH) {
    errors.push({ key: 'name', message: LONG_ARTICLE_NAME_MESSAGE })
  }

  let firstWithEmail = new Map<string, number>()
  cards.forEach((card, index) => {
    let number = index + 1
    if (card.name === '') {
      errors.push({ key: `author-${number}-name`, message: EMPTY_AUTHOR_NAME_MESSAGE })
    }
    let message = emailMessage(card.email)
    if (message !== null) {
      errors.push({ key: `author-${number}-email`, message })
      return
    }
    let key = card.email.toLowerCase()
    let first = firstWithEmail.get(key)
    if (first === undefined) firstWithEmail.set(key, number)
    else errors.push({ key: `author-${number}-email`, message: duplicateEmailMessage(first) })
  })

  if (cards.length > MAX_AUTHORS) errors.push({ key: 'authors', message: AUTHOR_LIMIT_NOTE })

  if (errors.length > 0) return { authors: cards, errors, ok: false }
  return { article: { authors: cards, name }, ok: true }
}

/** The label of the field an error points at, for the summary's links (`20b`). */
export function fieldLabel(key: FieldKey): string {
  if (key === 'name') return 'Název článku'
  if (key === 'authors') return 'Autoři'
  let match = /^author-(\d+)-(name|email)$/.exec(key)
  let number = match?.[1] ?? ''
  return match?.[2] === 'email' ? `E-mail autora ${number}` : `Autor ${number}`
}

/* `20a`, as the copywriter settled them (il3qqrj9). */
export const ARTICLE_PAGE_TITLE = 'Nový článek'
export const ARTICLE_PAGE_LEAD =
  'Pro článek vytvoříme dokument Google. V uvítacím e-mailu najdou autoři odkaz na dokument i na nahrání obrazových děl.'
export const REQUIRED_LEGEND = 'Pole s hvězdičkou jsou povinná.'
export const ARTICLE_NAME_LABEL = 'Název článku'
export const ARTICLE_NAME_PLACEHOLDER = 'Rozhovor s hostem'
export const AUTHORS_LEGEND = 'Autoři'
export const AUTHORS_HINT =
  'Každého autora po korektuře požádáme e-mailem o souhlas s redakční doložkou. Můžete přidat nejvýš 10 autorů.'
export const AUTHOR_NAME_LABEL = 'Jméno a příjmení'
export const AUTHOR_NAME_PLACEHOLDER = 'Jan Novák'
export const AUTHOR_EMAIL_LABEL = 'E-mail'
export const AUTHOR_EMAIL_PLACEHOLDER = 'jan.novak@external.test'
export const ADD_AUTHOR_LABEL = 'Přidat autora'
export const REMOVE_AUTHOR_LABEL = 'Odebrat'
export const CONSENT_SENTENCE =
  'Odesláním formuláře souhlasíte se zasíláním e-mailů k tomuto článku na uvedené adresy.'
export const CREATE_ARTICLE_LABEL = 'Vytvořit článek'
export const CREATING_ARTICLE_LABEL = 'Článek se vytváří…'

export function authorCardTitle(number: number): string {
  return `Autor ${number}`
}

export function removeAuthorName(number: number): string {
  return `Odebrat autora ${number}`
}

export function issueLine(issueName: string): string {
  return `Vydání ${issueName}`
}

/* The warnings under the lead, checked when the page opens (`20a`; `dkssdpyc`, `1jv85zum`). */
export const ACCOUNT_DISCONNECTED_WARNING =
  'Zkuste článek vytvořit později, nebo dejte vědět šéfredakci.'
export const ARTICLES_FOLDER_GONE_WARNING =
  'Z tohoto odkazu teď nejde založit článek. Šéfredakce vidí problém v aplikaci.'

/* `20c`: a step as the Callout's title, the result under it. */
export type SubmitMessage = { text: string; title: string }

export const LINK_GONE_ON_SUBMIT: SubmitMessage = {
  text: 'Tento odkaz mezitím přestal platit a článek se nevytvořil. Vyplněné údaje jsou stále na této stránce.',
  title: 'Napište šéfredakci o aktuální odkaz.',
}
export const DRIVE_UNAVAILABLE_ON_SUBMIT: SubmitMessage = {
  text: 'Článek se nevytvořil.',
  title: 'Zkuste článek vytvořit za chvíli znovu.',
}
export const LIMIT_REACHED_ON_SUBMIT: SubmitMessage = {
  text: 'Z tohoto odkazu už za poslední hodinu vzniklo 30 článků. Pokud článek potřebujete založit hned, napište šéfredakci.',
  title: 'Zkuste článek vytvořit později.',
}

/** Thirty articles in the last sixty minutes from one link (`02a`, `03` row 15). */
export const SUBMISSIONS_PER_HOUR = 30

/* `20d`. */
export const CREATED_TITLE = 'Článek je založený'

export function createdLead(articleName: string, issueName: string): string {
  return `„${articleName}“ je ve vydání ${issueName}.`
}

/** Only when the welcome e-mail went to every author; otherwise the page says nothing of it. */
export const ALL_WELCOMES_SENT = 'Uvítací e-mail jsme odeslali na všechny uvedené adresy.'
export const OPEN_DOCUMENT_LABEL = 'Otevřít dokument'
export const UPLOAD_ARTWORKS_LABEL = 'Nahrát obrazová díla'
export const WHAT_NEXT_TITLE = 'Co bude dál'
export const WHAT_NEXT_STEPS: readonly string[] = [
  'Píšete v dokumentu, redakce komentuje. Nové komentáře vám přijdou e-mailem nejvýš čtyřikrát denně.',
  'Až text dopíšete, předejte ho ke korektuře: v dokumentu na počítači vyberte Publikace › Předat ke korektuře. Můžete také dát vědět šéfredakci.',
  'Po korektuře přijde e-mail s finální verzí.',
  'Souhlas dáte odpovědí přesně „Souhlasím“.',
]
export const ANOTHER_ARTICLE_LABEL = 'Založit další článek'

/** `Alex Novák`, `Alex Novák a Robin Malá`, `Alex Novák, Robin Malá a Jan Novák`. */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} a ${names.at(-1)}`
}

/**
 * The welcome e-mail's line about the other authors, or `null` for a single author. The verb
 * follows the count alone: the app knows no gender (`docs/copy-context.md`).
 */
export function coauthorLine(coauthors: readonly string[]): string | null {
  if (coauthors.length === 0) return null
  let verb = coauthors.length === 1 ? 'podílí' : 'podílejí'
  return `Na článku se také ${verb} ${joinNames(coauthors)}.`
}

/** The line under an article's name in the detail (`12a`): its authors. */
export function authorsLine(authors: readonly Pick<Author, 'name'>[]): string {
  return authors.map((author) => author.name).join(', ')
}

/**
 * `_meta.json` in the article folder, in the script's shape: the Doc's menu and the artwork upload
 * read these keys. An issue in the app has no Evidence spreadsheet, so `sheetId` is `null`.
 */
export function articleMeta(article: {
  articleFolderId: string
  articleName: string
  authors: readonly Author[]
  docId: string
  issue: string
  issueFolderId: string
}): string {
  return JSON.stringify({
    docId: article.docId,
    articleName: article.articleName,
    issue: article.issue,
    articleFolderId: article.articleFolderId,
    issueFolderId: article.issueFolderId,
    sheetId: null,
    authors: article.authors.map((author) => ({
      authorName: author.name,
      authorEmail: author.email,
      authorSignature: author.name,
    })),
  })
}

/** The placeholder the template's body carries for the article's name, as the script replaces it. */
export const ARTICLE_NAME_PLACEHOLDER_IN_TEMPLATE = '{{NAZEV_CLANKU}}'

export const META_FILE_NAME = '_meta.json'

export function documentUrl(docId: string): string {
  return `https://docs.google.com/document/d/${encodeURIComponent(docId)}/edit`
}
