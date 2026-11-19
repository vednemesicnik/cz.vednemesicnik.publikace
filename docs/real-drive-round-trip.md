# The round trip against the real Drive

The suite and `pnpm app:fake` run every Drive, Docs and Mailer call against
`app/drive/fake-drive.server.ts` and a recording mailer. Those can only promise what the code
already expects. This run sends the same calls to the real services, from a local app, on a
test shared drive and a test Mailer. It is done once locally and once more on production before
the newsroom moves off the scripts. Until both pass, the scripts and the sheets stay the real
path.

A check that fails ends in one of two places. It is a fix with a test in the module's
`*.server.test.ts` that feeds the real answer through the injected `fetch`, or, when Drive cannot
do what the code assumes, a new issue. Each result goes into a comment on the issue that asked
for the run.

## Before the run

Nothing here is real data in the repository: the IDs, the URLs and the testers' addresses live in
`.env` and in the testers' own mailboxes, never in a file that is tracked.

**The Cloud project of the OAuth client** (the one `GOOGLE_CLIENT_ID` names):

- [ ] the authorised redirect URIs include both `http://localhost:44100/sign-in/google/callback`
      and `http://localhost:44100/settings/account/callback`;
- [ ] the consent screen offers the `https://www.googleapis.com/auth/drive` scope;
- [ ] the **Google Drive API** and the **Google Docs API** are enabled. The Docs API writes the
      article's name into the copied Doc (`documents.batchUpdate`, `replaceAllText`).

**A test shared drive**, never _Publikace_ or a folder the scripts use:

- [ ] `publikace.app@` is a member with the role **Content manager**, not Manager, because that
      is its role on _Publikace_ and the cleanup's bin is what is being tried;
- [ ] a folder in it holds the issues, and its ID is `ISSUES_FOLDER_ID`;
- [ ] a copy of the article template, made with _Vytvořit kopii_ in Drive so that it carries its
      bound script, is in that drive. Its body still contains `{{NAZEV_CLANKU}}`, and its ID
      is `ARTICLE_TEMPLATE_DOCUMENT_ID`.

**A test deployment of the Mailer** (`SCRIPT__Mail__Send`):

- [ ] deployed as a web app run as `publikace@`, with access _Anyone_. Anything narrower answers
      `/exec` with a login page, not JSON;
- [ ] its secret in its Script Properties, the same value as `MAIL_SEND_SECRET`; its `/exec` URL
      as `MAIL_SEND_URL`;
- [ ] every address the run types into a form is one a tester reads.

**`.env`**, edited by the tester:

- [ ] `DATABASE_PATH=./db/round-trip.sqlite`, a database for this run alone, deleted after it;
- [ ] `DRIVE_ACCOUNT_EMAIL` empty (it defaults to `publikace.app@` on `AUTHORIZED_DOMAIN`);
- [ ] `REGISTRY_SPREADSHEET_ID` empty. The app reads it nowhere yet, and the run must not reach
      the Registr even by mistake.

Then `pnpm app:dev`, sign in at `http://localhost:44100`, and in _Nastavení_ connect the account
with _Připojit účet_ as `publikace.app@`. Settings shows it connected, and the account banner is
gone.

## The run

In order: each check uses what the one before it made.

1. **An issue makes its folders.** _Nové vydání_ with a test name. The issues folder now holds a
   folder of that name, and inside it `Články` and `_Podklady_pro_tisk`. Nothing else appears
   anywhere on the drive.

   _Dokončit vydání_ adds only what is missing. Stop the app and, with `sqlite3`, run
   `UPDATE issues SET print_folder_id = NULL, completed_at = NULL WHERE name = '…'`, then start
   it again. The issue is _Nedokončené_. Do it twice:
   - with `_Podklady_pro_tisk` left in place, _Dokončit vydání_ adopts it, and no second folder
     appears. This is the look-up by name on a shared drive;
   - with `_Podklady_pro_tisk` moved to the bin in Drive first, _Dokončit vydání_ makes a new one
     beside `Články`, and the one in the bin stays there.

2. **An article makes its folder, its Doc and `_meta.json`.** Open the newsroom's link from the
   issue's page and send the form with one or two authors on testers' addresses. In
   `Články` there is a folder named after the article holding:
   - the Doc, a copy of the test template with the article's name where `{{NAZEV_CLANKU}}` was;
   - `_meta.json` with `docId`, `articleName`, `issue`, `articleFolderId`, `issueFolderId`,
     `sheetId` (`null`) and `authors`.

   Open the Doc. Its own menu appears in the menu bar. **Open the menu and run nothing from it.**
   Its items write to an issue's Evidence sheet, and with `sheetId` `null` they have none to
   write to.

3. **A failed step leaves its files in the bin.** Stop the app, set
   `ARTICLE_TEMPLATE_DOCUMENT_ID` to an ID that does not exist, start it, and send another
   article. The page refuses it. The article folder that attempt made is in the shared drive's
   bin, not in `Články`. This is also the check that a Content manager can move a file to the
   bin. Put the right ID back.

4. **The welcome e-mail arrives once per author.** Every author of the article in check 2 has
   one e-mail, _Článek „…“ je ve vydání …_, from `publikace@`. Then send the same form again:
   go back in the browser to the filled form and send it once more. The page answers as it did
   the first time, and no second e-mail arrives.

5. **Nothing the old scripts use was touched.** The Registr, every issue's Evidence sheet and the
   folders the scripts use show no change since the run began: check the _Poslední úprava_
   column in Drive and the sheets' version history.

6. **An upload goes to the article folder.** From the article page's link to the artworks, upload
   a JPEG, a PNG, a HEIC and a TIFF. Each is in the article folder, named by its hash with its
   extension, at its full size. Every upload is resumable. Include one close to the page's limit
   of 15 MB, the size that resumable uploads are for.

7. **The licence carries its preview.** Fill in author and source for each and send with _Odeslat
   díla_. The article folder now has a PDF per artwork, `<hash>.pdf`. Open each:
   - the preview image is in it, from the artwork's thumbnail;
   - for a format Drive makes no thumbnail of, the PDF says _[Náhled není k dispozici]_, and the
     batch was still sent.

   Note which formats got a preview: HEIC and TIFF are the open question. Temporary Docs named
   `_tmp_licence_…` are all in the bin.

8. **The consent request arrives once, with every PDF.** The provider's address has one e-mail
   whose subject begins _Žádost o potvrzení souhlasu s užitím obrazových děl_ and ends with a
   `[tag]`. It carries one PDF per artwork. Repeat with as many artworks as the page takes, up to
   20, to see the attachments under the Mailer's 25 MB. Then send the same form again from the
   browser's back button: nobody gets a second e-mail.

9. **The reply check finds the reply.** Reply _Souhlasím_ to the request from the provider's
   mailbox. Send `SCRIPT__Mail__Reply_Check` one signed `check` item. Sign it the way
   `signEnvelope()` in `app/mail/mailer.server.ts` signs the Mailer's, under the reply check's
   own secret. Its fields: `sender` is the provider's address, `subjectPrefix` is the prefix
   above, `subjectTag` is the tag without its brackets, and `expectedReply` is `souhlasím`. The
   answer is `reply_matches` with the thread. Nothing in the app changes: the app does not ask
   the reply check yet.

10. **A failed batch and the 24-hour sweep.**
    - Send a batch of many large artworks and stop the app while it is still sending. Start it
      again. The licences and temporary Docs that batch made are in the bin, the artworks are
      back on their page, and nobody got an e-mail.
    - Upload two artworks and send neither. In Drive, move one of them out of the article folder.
      Stop the app, run
      `UPDATE artworks SET uploaded_at = '2000-01-01T00:00:00.000Z' WHERE batch_id IS NULL AND removed_at IS NULL`,
      and start it: the sweep runs at startup. The one still in the article folder is in the
      bin. The one that was moved is where it was moved to.

## After the run

- [ ] remove `publikace.app@` from the test shared drive: _Publikace_ is the only shared drive
      it belongs to, because it holds the full `drive` scope;
- [ ] archive the test deployment of the Mailer;
- [ ] delete `./db/round-trip.sqlite` and set `.env` back;
- [ ] write the results into the issue: each check passed, fixed in a commit, or moved to a new
      issue.
