# Advanced PR Review — Piano di Fattibilità e di Implementazione

> Documento di lavoro. Nessun codice ancora scritto.
> Stack: **.NET 10 / Blazor Server + MudBlazor 9.8.0 + BlazorMonaco 3.5.0**, integrazione **Azure DevOps** via Anti-Corruption Layer, con portabilità futura verso GitHub.
> **UI e label dell'applicazione: solo inglese.** Questo documento di progetto è in italiano.

---

## 0. Decisioni prese

| Tema | Decisione |
|---|---|
| **Canale di integrazione con AZDO** | **Client REST .NET nativo** dentro l'ACL (API 7.1). Nessun `azdo-cli`, nessun Node.js in produzione. |
| **Autenticazione verso AZDO** | **PAT vault per-utente in M1**, **OAuth Entra ID in M8**, entrambi dietro `IAzureDevOpsCredentialSource`. Mai un service account: commenti e voti devono essere attribuiti al reviewer reale. |
| **Rifiuto di una fase** | **"Request changes on step"** = `vote -5` (*Waiting for author*) + commento marker. **"Reject entire PR"** = `vote -10`, azione separata e distruttiva. |
| **Thread di commento nel diff** | **Pannello laterale sincronizzato** con la riga selezionata + glyph decorations. Thread inline in Monaco rinviati a post-v1. |

---

## 1. Verdetto di fattibilità

**Fattibile.** Nessun blocco tecnico residuo; una sola domanda bloccante aperta (Q1 in §15), verificabile nello spike M0.

| Area | Fattibilità | Note |
|---|---|---|
| .NET 10 + Blazor + MudBlazor 9.8.0 | ✅ Nessun rischio | MudBlazor 9.8.0 ha target `net10.0` nativo (verificato su nuspec) |
| Monaco diff + pannello thread laterale | ✅ Basso | Usa solo API già esposte da BlazorMonaco 3.5.0 (`deltaDecorations`, `revealLineInCenter`). Il pacchetto arriva a target `net9.0`, compatibile con net10.0 |
| Parsing `<id>.pr-map.md` + motore a fasi | ✅ Basso | Logica interamente nostra, codice puro, testabile in isolamento |
| Lettura PR / file / diff | ✅ Basso | REST API 7.1 copre tutto |
| Commenti ancorati a righe, risposte, reazioni | 🟡 Medio | Il mapping line/offset fra Monaco e AZDO è il **principale rischio tecnico residuo** (§14) |
| Approve / Reject a livello PR | ✅ Basso | `PUT reviewers/{guid}` (vote) |
| Approvazione **di fase** | 🟡 Medio | Azure DevOps **non ha** il concetto di fase → modellata con un protocollo di commenti (§7) |
| Auto-complete PR | ✅ Basso | `PATCH pullrequests/{id}` |
| Sede della map e sua rimozione | ✅ Basso | Risolto spostando la map fuori dalla branch, in un thread della PR (§11): nessun push a fine review, niente da cancellare |
| Autenticazione multi-utente su server | 🟡 Medio | Risolta a livello di design (§9); PAT sblocca subito, OAuth Entra è la strada di produzione |

---

## 2. Integrazione con Azure DevOps

**Un thin client REST tipizzato scritto da noi**, dentro `AdvancedPr.Providers.AzureDevOps`: `HttpClient` + `IHttpClientFactory`, resilienza con Polly, `CancellationToken` propagato, streaming dei blob, caching HTTP nativo.

Perché non i pacchetti ufficiali `Microsoft.TeamFoundationServer.Client` / `Microsoft.VisualStudio.Services.Client`: l'ultima versione disponibile è **`20.277.0-preview`** — solo prerelease da anni, con dipendenze legacy. Un client REST nostro è anche più coerente con la logica ACL, perché non fa entrare tipi Azure DevOps nel resto della soluzione.

### 2.1 Perché non `azdo-cli`

Il repo `alkampfergit/azdo-cli` (v0.14.0) è stato letto e valutato. È una **CLI Node/TypeScript** (`bin: azdo`, `commander`, `@napi-rs/keyring`), non una libreria .NET: integrarla significherebbe process-spawn di Node per ogni operazione, con Node.js prerequisito di deploy e il contenuto dei file che passa per stdout. Le credenziali stanno nel keyring dell'OS (una identità per macchina), quindi il multi-utente sarebbe possibile solo iniettando `AZDO_PAT` per processo — precludendo OAuth.

Sul piano funzionale copre bene ciò che *sta intorno* alla review (checks, lettura thread, reply, resolve, pipeline, work item), ma **nessuna** delle capability centrali di questa app: elenco file modificati, contenuto dei blob, creazione di thread ancorati, voto, lista reviewer con voti, like, auto-complete, work item della PR, push, identità GUID.

**Know-how estratto dal repo e riusato in questo piano:**
- `pr status` unisce **tre** fonti di check — Status API + **policy evaluations** + Builds API. Le policy evaluations sono i check verdi della UI di Azure DevOps e **non** sono restituite dall'endpoint `statuses`: dettaglio non ovvio, recepito in §3.4.
- `oauth-flow.ts` / `oauth-token-refresh.ts`: flusso Entra + PKCE con refresh coordinato da lock per-org e ledger single-flight per-processo. Riferimento da rileggere in M8 (§9).
- `--trace` con redaction automatica di header e token: idea recepita in §9.2 (Diagnostics).

---

## 3. Endpoint Azure DevOps REST richiesti

Base: `https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repoId}` — sempre con `api-version=7.1`.

### 3.1 Lettura PR

| Scopo | Metodo & path |
|---|---|
| Identità corrente | `GET https://dev.azure.com/{org}/_apis/connectionData` → `authenticatedUser.id` |
| Lista PR | `GET /pullrequests?searchCriteria.status=active&searchCriteria.targetRefName=…&$top=…` |
| Dettaglio PR (include `reviewers[]`, `mergeStatus`, `_links.web`) | `GET /pullRequests/{prId}` |
| Work item collegati | `GET /pullRequests/{prId}/workitems` |
| Iterazioni (ogni push = iterazione) | `GET /pullRequests/{prId}/iterations` |
| File modificati per iterazione | `GET /pullRequests/{prId}/iterations/{it}/changes?$top=2000&$compareTo={it0}` |
| Commit della PR | `GET /pullRequests/{prId}/commits` |
| Contenuto blob (content-addressed → **cacheabile per sempre**) | `GET /blobs/{objectId}?$format=text` (oppure `octetStream`) |
| Contenuto file per ref (alternativa) | `GET /items?path={path}&versionDescriptor.version={sha}&versionDescriptor.versionType=commit&includeContent=true` |

### 3.2 Commenti

| Scopo | Metodo & path |
|---|---|
| Lista thread | `GET /pullRequests/{prId}/threads` |
| **Nuovo thread ancorato** | `POST /pullRequests/{prId}/threads` — body con `threadContext.filePath` + `rightFileStart/End {line, offset}` e `pullRequestThreadContext.iterationContext {firstComparingIteration, secondComparingIteration}` + `changeTrackingId` |
| **Nuovo thread generale** (approvazione di fase) | `POST /pullRequests/{prId}/threads` — **senza** `threadContext` |
| Reply | `POST /pullRequests/{prId}/threads/{tId}/comments` (`parentCommentId`, `commentType: 1`) |
| Edit / delete commento | `PATCH` / `DELETE /pullRequests/{prId}/threads/{tId}/comments/{cId}` |
| Stato thread (resolve/reopen) | `PATCH /pullRequests/{prId}/threads/{tId}` (`status: active\|fixed\|wontFix\|closed\|byDesign\|pending`) |
| Like | `PUT` / `DELETE` / `GET /pullRequests/{prId}/threads/{tId}/comments/{cId}/likes` |

> ⚠️ Senza `pullRequestThreadContext.iterationContext`, Azure DevOps non riesce a "seguire" il commento tra le iterazioni successive e il commento appare *outdated* nella UI nativa. Va gestito.

### 3.3 Voto e completamento

| Scopo | Metodo & path |
|---|---|
| Voto | `PUT /pullRequests/{prId}/reviewers/{identityGuid}` — `{ "vote": n }` con `10` approved, `5` approved with suggestions, `0` no vote, `-5` waiting for author, `-10` rejected |
| Auto-complete | `PATCH /pullrequests/{prId}` — `{ "autoCompleteSetBy": { "id": "{identityGuid}" }, "completionOptions": { "deleteSourceBranch": bool, "squashMerge": bool, "mergeStrategy": "…", "bypassPolicy": false } }` |
| Abort auto-complete | stesso `PATCH` con `autoCompleteSetBy.id = "00000000-0000-0000-0000-000000000000"` |

### 3.4 Checks e build

I check mostrati nella UI di Azure DevOps sono l'unione di **tre** fonti, da comporre in un solo elenco:

| Scopo | Metodo & path |
|---|---|
| PR statuses | `GET /pullRequests/{prId}/statuses` |
| **Policy evaluations** (sono i check verdi della UI, non presenti in `statuses`) | `GET https://dev.azure.com/{org}/{project}/_apis/policy/evaluations?artifactId=vstfs:///CodeReview/CodeReviewId/{projectId}/{prId}` |
| Build collegate | `GET https://dev.azure.com/{org}/{project}/_apis/build/builds?…` |
| GUID progetto (per l'`artifactId`) | `GET https://dev.azure.com/{org}/_apis/projects/{project}` |

Ogni `CheckResult` porta `source` (`status` / `policy` / `build`) e `isBlocking`. Un errore di recupero va mostrato come *"unable to retrieve"*, mai come *"no checks"*.

### 3.5 Scrittura sul repository (chiusura)

| Scopo | Metodo & path |
|---|---|
| Commit di delete + push | `POST /pushes` — `refUpdates:[{ name:"refs/heads/{sourceBranch}", oldObjectId:"{headSha}" }]`, `commits:[{ comment:"chore: remove PR review map", changes:[{ changeType:"delete", item:{ path:"/{id}.pr-map.md" } }] }]` |

`oldObjectId` deve essere l'head corrente del source branch: se qualcuno pusha nel frattempo il push viene rifiutato → retry con rilettura dell'head (optimistic concurrency, max 3 tentativi).

### 3.6 Scope PAT / OAuth necessari

- `vso.code` — PR, file, iterazioni, blob
- `vso.code_write` — thread, commenti, voti, push, auto-complete
- `vso.build` — build collegate
- `vso.work` — PBI collegato
- `vso.threads_full` — reazioni/like sui commenti

---

## 4. Architettura della soluzione

### 4.1 Modello di hosting

**Blazor Web App (.NET 10) con render mode `InteractiveServer`.**

Perché non WebAssembly:
- Le REST API di Azure DevOps **non sono CORS-friendly** dal browser.
- I token/PAT non devono mai raggiungere il client.
- Il contenuto dei file (diff di 100+ file) va recuperato e messo in cache **server-side**.
- Monaco gira comunque nel browser: l'interattività percepita non cambia.

Da gestire: circuito SignalR (reconnect, stato per-utente in memoria), sticky session se si scala su più istanze, dimensionamento della cache.

### 4.2 Struttura della soluzione

```
AdvancedPr.sln
├─ src/
│  ├─ AdvancedPr.Domain/                 # entità, value object, PORT (interfacce). Zero dipendenze.
│  ├─ AdvancedPr.Application/            # use case, PhasePlanner, ReviewStateMachine, PrMapParser
│  ├─ AdvancedPr.Infrastructure/         # EF Core, Data Protection, cache, audit
│  ├─ AdvancedPr.Providers.AzureDevOps/  # ★ ACL: client REST + mapper
│  ├─ AdvancedPr.Providers.GitHub/       # ☐ futuro: stessi port, altra implementazione
│  └─ AdvancedPr.Web/                    # Blazor Web App, MudBlazor, BlazorMonaco, JS interop
└─ tests/
   ├─ AdvancedPr.Domain.Tests/                 # parser pr-map, phase planner, state machine (puro, veloce)
   ├─ AdvancedPr.Providers.AzureDevOps.Tests/  # HTTP handler stub + payload registrati
   └─ AdvancedPr.Web.E2E/                      # Playwright: stepper, Monaco, commenti
```

**Regola ferrea dell'ACL:** nessun tipo o concetto di Azure DevOps (`vote: 10`, `refs/heads/…`, `vstfs:///…`, `threadContext`) attraversa il confine di `Providers.*`. Il mapping avviene solo lì. Verificabile con un architecture test (NetArchTest): `AdvancedPr.Application` non deve avere alcun riferimento a `Providers.*`.

### 4.3 Flusso di una pagina di review

```
Browser (Monaco + MudBlazor)
      │ SignalR
      ▼
ReviewSessionComponent ──► ReviewSessionService (Application)
                                │
                     ┌──────────┼─────────────┬──────────────┐
                     ▼          ▼             ▼              ▼
              PrMapParser  PhasePlanner  ReviewStateMachine  Ports
                                                              │
                                            ┌─────────────────┴──────────┐
                                            ▼                            ▼
                                  AzureDevOpsProvider            BlobCache (objectId → content)
                                   (HttpClient + Polly)
                                            │
                                            ▼
                                  dev.azure.com REST 7.1
```

---

## 5. Port dell'ACL

Nomi deliberatamente non-AZDO, così che GitHub li implementi senza forzature.

```
IIdentityProvider          CurrentUserAsync() → ReviewUser (Id, DisplayName, Email, AvatarUrl)
IPullRequestCatalog        ListAsync(filter) → PullRequestSummary[]
IPullRequestReader         GetAsync(prRef) → PullRequestDetail (incl. Reviewers, WebUrl, MergeState)
                           GetLinkedWorkItemsAsync(prRef) → LinkedWorkItem[]
                           GetRevisionsAsync(prRef) → Revision[]        // = iteration / push
                           GetChangedFilesAsync(prRef, revision) → ChangedFile[]
IFileContentReader         GetContentAsync(ContentRef) → FileContent    // ContentRef = blob id / sha+path
IReviewCommentStore        GetThreadsAsync(prRef) → CommentThread[]
                           CreateAnchoredThreadAsync(prRef, Anchor, body) → CommentThread
                           CreateGeneralThreadAsync(prRef, body) → CommentThread
                           ReplyAsync(prRef, threadId, body) → Comment
                           SetThreadStateAsync(prRef, threadId, ThreadState)
                           SetReactionAsync(prRef, threadId, commentId, bool liked)
IReviewDecisionStore       GetDecisionsAsync(prRef) → ReviewerDecision[]
                           SetDecisionAsync(prRef, ReviewDecision)      // Approve / ApproveWithSuggestions
                                                                        // / ChangesRequested / Reject / Reset
ICheckStatusReader         GetChecksAsync(prRef) → CheckResult[]        // merge status+policy+build (§3.4)
IRepositoryWriter          DeleteFileAsync(prRef, path, commitMessage)   // solo per il mirroring (§11.3)
IPullRequestCompletion     SetAutoCompleteAsync(prRef, CompletionOptions)
IPrMapSource               ResolveAsync(prRef) → PrMapDocument          // thread > file in branch (§11.3)
                           PublishAsync(prRef, PrMapDocument)           // scrive/aggiorna il thread della map
IProviderCapabilities      Supports(Capability)                         // degradazione UI per GitHub
```

`PullRequestRef` = `(ProviderId, Organization, Project, RepositoryId, PullRequestId)` — value object opaco.

`IProviderCapabilities` è la valvola di sfogo per le differenze fra provider: la UI disabilita i pulsanti non supportati invece di lanciare eccezioni.

---

## 6. Il file `<id>.pr-map.md`

### 6.1 Risoluzione della map

`IPrMapSource.ResolveAsync` applica questa precedenza (§11.3):

1. **Thread di commento della PR** con marker `{"kind":"pr-map"}` → se presente, vince. È la sede di arrivo.
2. **File `<id>.pr-map.md` fra i file modificati della PR** → fallback e bootstrap del mirroring:
   - `GET /pullRequests/{prId}/workitems` → ID dei work item collegati;
   - cerca `<workItemId>.pr-map.md`; con più work item collegati, prova ciascuno in ordine deterministico (id crescente);
   - se esiste un solo `*.pr-map.md` fra i file della PR, usalo con warning *"map name does not match linked work item"*.
3. Nessuna map → **una sola fase**, `"Everything else"`, con tutti i file.

Il formato del documento è identico nelle due sedi: **lo stesso parser** (§6.2) lavora sul contenuto del file o sul corpo del commento, indifferentemente.

### 6.2 Grammatica (tollerante)

```
1. Core
- path/file/1
- path/file/2

2. Tests
- path/file/4
```

- **Intestazione di fase**: riga che inizia con `N.` / `N)` / `## N.` / `## Titolo`. Il titolo è il testo dopo il numero, `trim`.
- **Il numero è decorativo, non ordinante.** ⚠️ Nell'esempio fornito ci sono **due sezioni numerate `2.`** ("Tests" e "Public API"): le fasi vanno ordinate per **posizione nel documento**, ignorando il numero. Questo rende il file robusto a copia-incolla e riordini.
- **Voce file**: riga che inizia con `-`, `*` o `+`. Path normalizzato: rimozione di backtick e sintassi link markdown, `./` e `/` iniziali, conversione `\` → `/`.
- Righe vuote e testo libero fra le voci: ignorati (permette commenti descrittivi nel file).
- **Duplicati fra fasi**: vince la **prima** occorrenza; warning visibile nella UI.
- **Path non presenti nella PR**: warning *"stale entry"* (segnala una map non aggiornata).
- **Path presenti nella PR ma non nella map** → fase finale `"Everything else"`.
- **La fase `"Everything else"` esiste sempre**, anche se vuota: è il punto di sign-off della PR intera (§7.4).

### 6.3 Output del parser

```
PhasePlan {
  Phases:  [ ReviewPhase { Order, Title, IsCatchAll, Files[] } ],
  Warnings:[ Duplicate(path, keptIn, alsoIn), StaleEntry(path), MapNotFound, MapNameMismatch ],
  SourceMapPath, SourceMapContentHash   // hash per invalidare le approvazioni (§7.5)
}
```

Il parser è **codice puro, senza I/O** → interamente coperto da unit test. È il primo pezzo da scrivere.

---

## 7. Approvazione per fasi

Azure DevOps non conosce le fasi. Serve un protocollo, e la scelta di fondo è:

> **Azure DevOps è la fonte di verità dello stato di review.** Il nostro database non contiene stato di review.

Vantaggi: nessuna desincronizzazione, stato visibile anche a chi usa la UI nativa AZDO, app riavviabile e scalabile senza stato — e i commenti di approvazione fase sono esattamente ciò che il requisito chiede.

### 7.1 Protocollo di marcatura

Un **thread generale per fase**, creato in modo lazy alla prima approvazione, con un marker leggibile dalla macchina in ogni commento:

```markdown
✅ **Phase approved — `Core`** (phase 1 of 4)

<!-- advanced-pr:v1 {"kind":"phase-approval","phase":"Core","order":1,"total":4,"revision":3,"mapHash":"a1b2c3d4"} -->
```

- L'HTML comment è invisibile nella UI di Azure DevOps → i commenti restano leggibili per gli umani.
- Il marker è versionato (`v1`) per poter evolvere.
- Le approvazioni di più utenti sulla stessa fase sono **reply nello stesso thread** → *"chi ha approvato questa fase"* si legge direttamente dal thread, senza DB.

`kind` previsti: `phase-approval`, `phase-changes-requested`, `pr-rejected`, `review-closed`.

### 7.2 Ripresa della sessione ("dove ero rimasto")

All'ingresso dell'utente nella PR:

1. Carica PR, revisione corrente, file modificati, `pr-map` → `PhasePlan`.
2. Carica i thread; estrai tutti i marker.
3. Filtra per `user == currentUser` e `mapHash == PhasePlan.SourceMapContentHash`.
4. **Fase attiva = prima fase senza approvazione dell'utente corrente.**
5. Se tutte approvate → schermata di sign-off della PR (stato del voto dell'utente + azione di chiusura).

### 7.3 Request changes / Reject

Attenzione alla semantica di Azure DevOps: il voto è **un singolo valore per reviewer sull'intera PR**, non per fase. Due azioni distinte, con peso visivo diverso:

| Azione UI | Effetto su AZDO | Peso visivo |
|---|---|---|
| **Request changes on step** (azione di fase) | `vote -5` *Waiting for author* + marker `phase-changes-requested` | pulsante secondario, accanto ad "Approve step" |
| **Reject entire PR** (azione a livello PR) | `vote -10` *Rejected* + marker `pr-rejected` | distruttiva: `Color.Error`, dialog di conferma, non adiacente alle azioni di fase |

Il voto `-5` è reversibile: alla successiva approvazione torna a `0` (no vote) se restano fasi da approvare, o a `10` all'approvazione finale (§7.4). Poiché `-5` è comunque uno stato *globale* dell'utente sulla PR, la UI deve dirlo esplicitamente: *"your PR vote is now Waiting for author"*. La granularità di fase vive nei marker.

### 7.4 Approvazione dell'ultima fase → approvazione della PR

Quando l'utente approva la fase finale `"Everything else"`:
1. Scrive il marker di approvazione fase (coerenza del log).
2. `IReviewDecisionStore.SetDecisionAsync(Approve)` → `PUT reviewers/{me}` con `vote = 10`.
3. La UI cambia stato in modo **visivamente forte** (requisito: l'approvazione dell'intera PR è più importante di quella di fase).

Guardrail: dialog di conferma con riepilogo (*"You are approving the whole pull request — 4 phases, 127 files"*).

### 7.5 Invalidazione su nuovo push

Ogni push crea una nuova iterazione. Le approvazioni di fase contengono `revision` e `mapHash`; se la revisione corrente è maggiore:
- se i file di quella fase **non** sono cambiati fra le due revisioni → approvazione ancora valida (badge *"approved at rev 3"*);
- se sono cambiati → badge **"needs re-review"** e la fase torna attiva.

Il confronto si fa con `GET iterations/{new}/changes?$compareTo={old}` — nessun costo aggiuntivo di modellazione.

### 7.6 Macchina a stati della fase

```
NotStarted ──open──► InReview ──approve──► ApprovedByMe ──(push su file della fase)──► NeedsReReview
                        │  ▲                                                                 │
        request changes │  │ (nuovo push dell'autore)                                        │
                        ▼  │                                                                 │
                  ChangesRequested ◄──────────────────────────────────────────────────────────┘
                     (vote -5)
```

`ChangesRequested` non è terminale: un nuovo push dell'autore riporta la fase a `InReview` per quel reviewer (il voto `-5` resta finché non approva). Il reject dell'intera PR (`vote -10`) è **fuori** da questa macchina a stati: è un'azione a livello di PR.

Stato aggregato per fase: `ApprovedBy[]`, `ChangesRequestedBy[]`, `OpenThreadCount`, `ApprovedAtRevision`.

---

## 8. Persistenza

| Dato | Dove | Note |
|---|---|---|
| Stato della review (approvazioni fase, commenti, voti) | **Azure DevOps** | §7 — nessun DB |
| Configurazione organizzazioni/progetti/repo | DB | pagine di backoffice |
| Credenziali per-utente (PAT cifrato / refresh token) | DB + **ASP.NET Data Protection** (o Azure Key Vault) | §9 |
| Cache contenuto blob (`objectId → bytes`) | `HybridCache` memoria + disco/Redis | `objectId` è content-addressed → **cache immutabile, TTL lungo** |
| Cache PR/threads/checks | `HybridCache`, TTL 30–60 s + invalidazione su azione utente | |
| Audit log delle azioni (chi ha approvato/rifiutato/chiuso, quando) | DB | utile per compliance |
| Preferenze utente (tema, font Monaco, whitespace) | DB | |

DB: **EF Core** con provider configurabile — SQLite per self-hosted/dev, SQL Server/PostgreSQL per il cloud.

---

## 9. Autenticazione e identità

**Livello 0 — accesso all'app:** OIDC verso Microsoft Entra ID (lo stesso tenant di AZDO) → SSO. Per il self-hosted, qualunque provider OIDC.

**Livello 1 — credenziale verso AZDO:** due implementazioni di `IAzureDevOpsCredentialSource`, coesistenti per utente e selezionate a runtime.

### Fase 1 (M1) — PAT vault per-utente
- Al primo accesso l'app chiede il PAT del reviewer, con link diretto alla pagina di creazione e scope precompilati (§3.6).
- Cifrato a riposo con Data Protection (key ring persistito) o Key Vault, legato all'identità dell'app.
- Gestione della scadenza: banner di avviso preventivo, rilevazione 401/203 e prompt di rinnovo.
- Sblocca M0–M7 senza dipendenze dal tenant.

### Fase 2 (M8) — OAuth Entra ID per-utente
- App registration in Entra con permessi delegati sulla risorsa Azure DevOps (`499b84ac-1321-427f-aa17-267ca6975798`).
- Authorization Code + PKCE; **refresh token** conservato server-side cifrato; access token rinnovato silenziosamente.
- L'utente consente **una volta sola** e non vede più nulla: è la risposta piena al requisito *"non autenticarsi ogni volta"*. Nessun segreto a lunga vita gestito dall'utente, revocabile centralmente, MFA/Conditional Access rispettati.
- ⚠️ Da evitare il vecchio OAuth `app.vssps.visualstudio.com`: è in dismissione. La strada è Entra.
- Da chiarire prima di M8: disponibilità di una app registration nel tenant e stato della policy AZDO *"Third-party application access via OAuth"*. Se bloccata, la Fase 1 resta come fallback per utente.

### 9.1 Identità e attribuzione
- `GET /_apis/connectionData` → `authenticatedUser.id` (GUID) = `reviewerId` per il voto e `autoCompleteSetBy`.
- Va verificato che l'identità Entra dell'app corrisponda a quella AZDO usata: se un utente incolla il PAT di un'altra persona l'attribuzione divergerebbe → **validazione al salvataggio** (confronto email/`uniqueName`) e blocco in caso di mismatch.

### 9.2 Backoffice di configurazione
Pagine riservate al ruolo `Administrator`:
- **Organizations**: nome org, base URL, progetti, repository monitorati, PAT di sola lettura opzionale per la *discovery* delle PR.
- **Providers**: provider attivo (AzureDevOps / GitHub), capability visibili.
- **Review settings**: nome del file map (default `{id}.pr-map.md`), `completionOptions` di default per l'auto-complete, ruoli autorizzati alla chiusura.
- **Users & credentials**: stato credenziale per utente, scadenze PAT, revoca.
- **Diagnostics**: test di connessione, scope effettivi del token, HTTP trace con redaction di header e token.

---

## 10. UI / UX

### 10.1 Mappa delle pagine

| Route | Contenuto |
|---|---|
| `/` | **My reviews** — PR dove sono reviewer, con progresso a fasi (`Core ✓ · Tests ✓ · API ○ · Everything else ○`) |
| `/pr/{provider}/{org}/{project}/{repo}/{id}` | **Review workspace** (schermata principale) |
| `/pr/.../overview` | Info PR, checks & build, reviewer e voti, work item, link ad AZDO |
| `/admin/*` | Backoffice (§9.2) |
| `/me` | Credenziali e preferenze |

### 10.2 Review workspace

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ PR #4821 · Refactor payment pipeline        [🔗 Open in Azure DevOps]  ✓4 ✗1 ⏳2  │
│ ▓▓▓ PULL REQUEST — Approved by you · 2 of 3 required reviewers ▓▓▓  ← banner forte│
├───────────────────────────────────────────────────────────────────────────────────┤
│ ①Core ✓ ──── ②Tests ✓ ──── ③Public API ● ──── ④Everything else ○     (MudStepper) │
├──────────────┬─────────────────────────────────────────┬──────────────────────────┤
│ FILES (2/7)  │ Monaco DiffEditor  [side-by-side│inline] │ THREADS — Api.cs (3)     │
│              │ ┌─────────────────────────────────────┐ │ ┌──────────────────────┐ │
│ ● Api.cs  3💬│ │ 41   unchanged                      │ │ │ L43 · active         │ │
│ ● Dto.cs     │ │💬42 - old line                      │ │ │ @mario: should be    │ │
│ ○ Map.cs     │ │  43 + new line   ◄─ selection       │ │ │ nullable        👍2  │ │
│ ○ Api.Tests  │ │ 44   unchanged   [💬 Comment]       │ │ │ [Reply] [Resolve]  ◄─┼─┐
│              │ │                                     │ │ ├──────────────────────┤ │
│ ─────────────│ │  ▲ glyph margin 💬 = commented line │ │ │ L88 · resolved       │ │
│ Approve step │ │                                     │ │ │ @lucia: nit …    👍1 │ │
│ Request      │ └─────────────────────────────────────┘ │ └──────────────────────┘ │
│  changes     │        click riga ◄──── sync ────► click card                      │
└──────────────┴─────────────────────────────────────────┴──────────────────────────┘
   ⚠ Reject entire PR — azione separata, colore Error, fuori dal blocco di fase
```

- **MudStepper** per le fasi, con badge: approvata da me / approvata da N / needs re-review / commenti aperti.
- **Tre livelli di enfasi visiva**, mai lo stesso peso:
  1. **Pull request approval** — banner a piena larghezza, colore primario, in cima. L'elemento più forte della pagina.
  2. **Approve step / Request changes on step** — pulsanti secondari in fondo alla colonna file.
  3. **Reject entire PR** — distruttiva (`Color.Error`), separata dal blocco di fase, con conferma.
- Lista file della fase con stato per-file (visitato / con commenti aperti) e progresso `visited/total`.
- Pannello **Overview** (drawer): checks con `source` e `isBlocking`, build con link, reviewer con voto, work item collegati.
- Pannello **Discussion** (drawer): tutti i thread della PR, non solo della fase corrente — filtri *open / resolved / mine / code-only*, reply e like.
- **Keyboard-first**: `j/k` file successivo/precedente, `n/p` thread successivo/precedente, `a` approve step, `c` comment on selection.
- **Warning della map** mostrati in modo non bloccante (banner richiudibile).

### 10.3 Monaco

- `MonacoDiffEditor` di BlazorMonaco (side-by-side + inline toggle).
- **Commento su selezione**: leggere `getSelection()` → start/end line+column e mapparlo su `threadContext.rightFileStart/rightFileEnd {line, offset}`. L'offset AZDO è **1-based** come le colonne Monaco (da confermare in M0). Va tracciato anche il **lato** del diff: i commenti sulla versione base usano `leftFileStart/End`.
- **Thread nel pannello laterale**, con interazione bidirezionale:
  - Thread del file corrente a destra, **ordinati per riga**.
  - *Editor → pannello*: click su una riga commentata → scroll-to + evidenziazione della card.
  - *Pannello → editor*: click su una card → `revealLineInCenter` + selezione del range originale.
  - Righe con commenti marcate via `deltaDecorations` + `glyphMarginClassName` — API già esposta da BlazorMonaco, **nessun interop custom**. È questo che dà il segnale visivo "qui c'è una discussione" senza pagare il costo delle view zones.
  - Contatore di thread per file nella lista di sinistra.
- **Post-v1**: thread inline dentro l'editor (view zones + content widgets, modulo `wwwroot/js/pr-diff-interop.js`). Il pannello resta utile come vista d'insieme, quindi il lavoro della v1 non va buttato.
- **Performance con 100+ file**: una sola istanza di editor riusata cambiando i model (non un editor per file); `MudVirtualize` sulla lista file; blob lazy e in cache; file binari e file oltre soglia (es. 1 MB / 5000 righe) non renderizzati, con avviso e link ad AZDO.

---

## 11. Dove vive la map, e l'azione di chiusura

### 11.1 Il problema, riformulato

Il rischio del "delete a fine review" **esiste solo perché la map vive dentro la branch**. Ma la map è **generata dall'AI**: il momento della sua nascita è sotto il nostro controllo, quindi la soluzione va cercata a monte, non a valle.

Due vincoli verificati che orientano la scelta:

- **Descrizione della PR: massimo 4000 caratteri** (conteggiati in UTF-16, quindi emoji ed accenti costano più di un carattere). Una map con 127 path da ~40 caratteri li supera → **la descrizione è esclusa** come sede della map.
- Il reset dei voti **non è automatico**: è un'opzione della policy *"Require a minimum number of reviewers"*, in due varianti — *reset approval votes* (azzera solo le approvazioni, conserva reject e wait) e *reset all votes*. Se l'org non la ha attiva, il push finale è innocuo.

E un'osservazione che riduce da sola la severità: **lo stato delle fasi vive nei commenti** (§7.1), e i commenti sopravvivono a qualunque push. Un reset dei voti non fa perdere il log delle approvazioni di fase — l'unica vittima è il singolo `vote 10` finale di ciascun reviewer, recuperabile con un click ("your vote was reset by a push — re-approve"). Fastidioso con più reviewer, non distruttivo.

### 11.2 Alternative valutate

| # | Dove vive la map | Push a fine review | Finisce nel target branch | Note |
|---|---|---|---|---|
| **1** | **Thread di commento della PR** 🎯 | **No** | **No** | L'AI scrive la map in un thread generale con marker `{"kind":"pr-map"}`. Nessun file, nessun push, nessuna iterazione, niente da cancellare. Editabile senza commit quando l'AI aggiunge file. Visibile in AZDO agli umani. Limite di lunghezza ampio. Portabile a GitHub senza modifiche |
| **2** | Ref git dedicato (`refs/advanced-pr/maps/{prId}`) | No | No | Resta in git — versionato, diffabile, auditabile — ma fuori dalla PR, quindi non merge-abile e senza iterazioni. Richiede che l'AI sappia pushare un ref non-branch. Più esotico da spiegare |
| **3** | **File nella branch, specchiato e cancellato subito** 🎯 | **No** (il push avviene all'inizio) | No | Mantiene **intatto il workflow attuale dell'AI**. Alla prima apertura l'app legge il file, lo specchia in un thread (opzione 1) e lo cancella **subito**, quando non esistono ancora approvazioni: il reset voti a quel punto è gratuito. Da lì il commento è la copia di lavoro |
| 4 | File nella branch, cancellato a fine review | Sì | No | Il piano precedente. Espone al reset dei voti nel momento peggiore |
| 5 | File nella branch, cancellato dall'autore/AI nel suo ultimo commit | No (non da parte nostra) | No | Fragile: la map serve **fino alla fine** della review, ma l'ultimo commit dell'autore arriva prima. Richiede coordinamento umano |
| 6 | File nella branch, **mai cancellato** | No | **Sì** | Costo zero di codice e di rischio. La map finisce nel repo (es. in `docs/pr-maps/`) come documentazione della review. Accettabile se il rumore non disturba |
| ~~7~~ | ~~Descrizione della PR~~ | — | — | **Esclusa**: limite di 4000 caratteri |

> ⚠️ Da chiarire subito, perché è un'aspettativa comune e sbagliata: **lo squash merge non aiuta.** Il merge produce l'albero finale del source branch, non i suoi commit — se il file è presente sul tip, finisce nel target sia con merge normale sia con squash.

### 11.3 Proposta

**Opzione 1 come design di arrivo, opzione 3 come percorso compatibile con il workflow attuale.**

Si introduce un port `IPrMapSource` con precedenza esplicita:

```
IPrMapSource.ResolveAsync(prRef) → PrMapDocument
   1. thread di commento con marker {"kind":"pr-map"}   ← se presente, vince
   2. file <id>.pr-map.md fra i file della PR            ← fallback / bootstrap
   3. nessuna map → fase singola "Everything else"
```

Con il **mirroring** attivo (configurabile), alla prima apertura della PR l'app: legge il file dalla branch → crea il thread con la map → cancella il file (§3.5) → da quel momento la sorgente è il commento. Il push resta, ma si sposta in un punto in cui non c'è nulla da invalidare.

Cosa si guadagna:
- l'azione di chiusura si riduce a **auto-complete + commento di chiusura**: sparisce il suo passaggio più rischioso;
- `IRepositoryWriter.DeleteFileAsync` diventa opzionale (serve solo al mirroring), e con l'opzione 1 pura non serve affatto;
- il rischio "reset dei voti a fine review" **si estingue**, e con esso la domanda Q1 di §15;
- la map resta modificabile durante la review senza toccare la branch — utile se l'AI aggiunge file dopo il primo push;
- su GitHub funziona identicamente (un commento è un commento), quindi §12 si semplifica.

Cosa si perde: la map non è più versionata in git insieme al codice (l'opzione 2 la recupererebbe, a costo di un meccanismo più oscuro).

### 11.4 Sequenza di chiusura

Con l'opzione 1 (o dopo il mirroring dell'opzione 3):

1. **Guard**: tutte le fasi approvate dall'utente corrente; utente autorizzato (§15 Q8); PR ancora `active`.
2. **Auto-complete**: `PATCH /pullrequests/{id}` con `autoCompleteSetBy = {id: currentUserGuid}` e le `completionOptions` configurate.
3. Commento generale di chiusura con marker `{"kind":"review-closed"}` per tracciabilità.
4. Il thread della map viene risolto (`status: closed`) per togliere rumore dalla PR.

Se invece si resta sull'opzione 4 (delete tardivo), l'ordine **delete → auto-complete** è obbligatorio: il push crea una nuova iterazione e fa ripartire build e policy, quindi l'auto-complete va impostato **dopo**, così la PR si completa quando le policy della *nuova* iterazione passano. Impostandolo prima, si rischia che la PR si chiuda e il push venga poi rifiutato (branch già mergiato o eliminato). Il delete usa `POST /pushes` con `oldObjectId` = head corrente e retry su conflitto (§3.5).

---

## 12. Portabilità verso GitHub

| Port | Azure DevOps | GitHub |
|---|---|---|
| `GetChangedFiles` | `iterations/{it}/changes` | `GET /repos/{o}/{r}/pulls/{n}/files` |
| `IFileContentReader` | `blobs/{objectId}` | `contents/{path}?ref={sha}` o `git/blobs/{sha}` |
| `CreateAnchoredThread` | `POST /threads` + `threadContext` | `POST /pulls/{n}/comments` (`path`, `line`, `side`, `start_line`) |
| `Reply` | `POST /threads/{t}/comments` | `POST /pulls/{n}/comments` con `in_reply_to` |
| `SetThreadState` | `PATCH /threads/{t}` | **solo GraphQL** (`resolveReviewThread`) |
| `SetReaction` | `PUT .../likes` | `POST /pulls/comments/{id}/reactions` (`+1`) |
| `SetDecision` | `PUT /reviewers/{id}` (vote) | `POST /pulls/{n}/reviews` (`APPROVE` / `REQUEST_CHANGES`) |
| `GetChecks` | statuses + policy evaluations + builds | `commits/{sha}/check-runs` + `/status` |
| `SetAutoComplete` | `PATCH /pullrequests/{n}` | **solo GraphQL** `enablePullRequestAutoMerge` |
| `DeleteFile` | `POST /pushes` | `DELETE /repos/{o}/{r}/contents/{path}` |
| `GetRevisions` | iterations | nessun equivalente → mappare sui commit della PR |
| `IPrMapSource` | thread della PR (o file `<id>.pr-map.md`) | thread della PR — **identico**; il fallback su file non ha il work item id, quindi userebbe issue collegata o numero PR |

Differenze che l'astrazione assorbe: nessun `pending` thread state; nessun voto *waiting for author* (→ `REQUEST_CHANGES`); alcune operazioni solo GraphQL, quindi l'adapter GitHub sarà REST+GraphQL misto — e non deve trasparire fuori.

Nota: con la map in un thread della PR (§11.3) la portabilità **migliora** — spariscono sia la dipendenza dal work item id (che su GitHub non esiste) sia la `DeleteFile`, che era una delle operazioni più divergenti fra i due provider.

---

## 13. Roadmap

| # | Milestone | Contenuto | Esito verificabile |
|---|---|---|---|
| **M0** | **Spike di fattibilità** ⏱️ priorità massima | Vedi §16 | Un diff reale con un commento creato dall'app, visibile in AZDO |
| **M1** | Scheletro | Solution, ACL, DI, EF Core, MudBlazor, OIDC login, PAT vault per-utente, backoffice Organizations, HTTP tracing con redaction | App che lista le PR di un repo configurato |
| **M2** | PR overview | Dettaglio PR, checks (status+policy+build), reviewer e voti, work item, link ad AZDO | Pagina overview completa |
| **M3** | Motore a fasi | `PrMapParser` + `PhasePlanner` + `IPrMapSource` (thread > file, §6.1) + MudStepper + lista file per fase, warning della map | Fasi corrette su una PR reale: map da thread, map da file, nessuna map |
| **M4** | Diff viewer | Monaco diff, cache blob, virtualizzazione, gestione binari/file grandi | PR da 100+ file navigabile in modo fluido |
| **M5** | Commenti (lettura) | Thread, pannello laterale sincronizzato + glyph decorations, filtri | Tutti i commenti AZDO visibili e ancorati alla riga |
| **M6** | Commenti (scrittura) | Nuovo thread su selezione, reply, like, resolve/reopen | Round-trip completo verificato nella UI AZDO |
| **M7** | Approvazioni | Approve step / Request changes / Reject entire PR con protocollo marker, ripresa sessione, sign-off PR, invalidazione su push | Due utenti approvano fasi diverse e si vedono a vicenda |
| **M8** | Chiusura + hardening | Azione di chiusura (auto-complete + commento di chiusura; mirroring/delete solo se serve, §11.3), OAuth Entra ID, resilienza/rate limit, audit log, telemetria, E2E Playwright | Ciclo di review end-to-end su una PR reale |
| **M9** | Portabilità | Adapter GitHub, architecture test, degradazione UI via capability | La stessa UI su una PR GitHub |
| **M+** | Post-v1 | Thread **inline** in Monaco (view zones + content widgets) | Esperienza pienamente AZDO-like |

---

## 14. Rischi e mitigazioni

| Rischio | Impatto | Mitigazione |
|---|---|---|
| **Mapping line/offset dei commenti fra Monaco e AZDO** (left/right, 1-based, iterazioni) | **Alto — principale rischio residuo** | Verifica in M0 con round-trip reale nella UI AZDO, su entrambi i lati del diff e su una PR con più iterazioni |
| Policy che resettano i voti dopo un push → il delete della map blocca l'auto-complete | Basso *(era Medio-alto)* | **Rimosso dal design**: la map esce dalla branch (§11.3), quindi a fine review non c'è alcun push. Residuo: lo stato delle fasi vive nei commenti e sopravvive ai push; solo il `vote 10` finale può essere azzerato, con re-approve a un click |
| Il thread della map viene modificato o cancellato a mano da un utente | Basso | Marker riconoscibile, `mapHash` per rilevare la modifica, fallback al file in branch se ancora presente, warning in UI |
| Performance/memoria con PR da 100+ file (Blazor Server, stato per-circuito) | Medio-alto | Un solo editor riusato, virtualizzazione, cache blob per `objectId`, soglie sui file grandi, limiti di memoria per circuito |
| Voto unico per reviewer sull'intera PR vs granularità di fase (`-5` = stato globale) | Medio | Testo UI esplicito sull'effetto del voto (§7.3); i marker restano la fonte della granularità di fase |
| PAT scaduti / revocati | Medio | Rilevazione 401/203, banner preventivo, migrazione a OAuth Entra (M8) |
| Policy tenant che blocca l'OAuth app (M8) | Medio | La Fase 1 (PAT) resta disponibile come fallback per utente |
| Rate limit / throttling AZDO (`Retry-After`, `X-RateLimit-*`) | Medio | Polly con retry+jitter, rispetto di `Retry-After`, caching aggressivo, batching |
| Scrittura concorrente di due reviewer sullo stesso thread di fase | Basso | Le reply sono append-only → nessun conflitto reale; refresh ottimistico |
| Map non aggiornata rispetto ai file della PR | Basso | Warning espliciti, fase catch-all che assorbe tutto |
| Riscrittura in C# del merge dei check (3 fonti) | Basso | Logica documentata in §3.4; copertura con payload registrati |
| BlazorMonaco target massimo `net9.0` | Basso | Compatibile con net10.0; in caso di problemi, interop diretto su monaco-editor |

---

## 15. Domande aperte

### Bloccante (serve entro M3)

- **Q1 — Sede della map.** Quale delle alternative di §11.2? **(1)** l'AI scrive la map direttamente in un **thread di commento** della PR (nessun file, nessun push, niente da cancellare); **(3)** l'AI continua a creare il file nella branch e l'app lo **specchia nel thread e lo cancella subito** all'inizio della review; **(2)** ref git dedicato fuori dalla PR; **(6)** file lasciato nella branch e mergiato come documentazione.
  *Raccomandazione: **(1)** come design di arrivo, con **(3)** attivabile se preferisci non toccare il prompt/workflow dell'AI che genera la map. Le due coesistono grazie alla precedenza di `IPrMapSource` (§6.1).*

### Sul comportamento funzionale (servono da M3)

- **Q2 — Posizione della map.** `<id>.pr-map.md` sta sempre in root del repository, o va cercata in qualunque cartella fra i file della PR?
- **Q3 — La map nella lista file.** Il file `<id>.pr-map.md` va escluso dai file da rivedere, o mostrato nella fase "Everything else"?
- **Q4 — Glob/prefissi nella map.** Vuoi supportare voci tipo `src/Core/**` o `src/Core/` oltre ai path esatti?
- **Q5 — Ordine delle fasi.** Le fasi vanno percorse **in sequenza** (non si passa a Tests senza aver approvato Core) o l'utente può saltare liberamente?
- **Q6 — Guardrail sull'approvazione finale.** Bloccare l'approvazione della PR se l'utente ha thread ancora aperti creati da lui? Solo warning? Nessun controllo?
- **Q7 — Chi vede cosa.** Un utente che **non** è reviewer della PR può aprirla in lettura? E può commentare?

### Su infrastruttura e processo

- **Q8 — Autorizzazione all'azione di chiusura.** Solo l'autore della PR, qualunque reviewer che ha completato tutte le fasi, o un ruolo configurabile?
- **Q9 — Multi-org.** Una singola istanza deve servire più organizzazioni AZDO contemporaneamente, o una sola org configurata?
- **Q10 — Azure DevOps Server on-prem.** Va supportato (URL base configurabile, `_apis` su collection, auth NTLM/Basic) o solo `dev.azure.com` cloud?
- **Q11 — Deployment target.** Container Linux (Azure Container Apps / Kubernetes) o IIS/Windows? Serve per decidere Data Protection key ring, sticky session e provider DB.
- **Q12 — Utenti concorrenti attesi.** Serve a dimensionare Blazor Server (circuiti) e la cache; oltre una certa soglia conviene Redis per la cache dei blob.
- **Q13 — Notifiche.** Servono notifiche (email/Teams) quando una fase viene approvata o rifiutata, o basta la UI?

---

## 16. Prossimo passo: lo spike M0

Cinque verifiche, in ordine. Chiudono i dubbi tecnici che possono ancora cambiare il piano, prima di scrivere l'architettura vera.

1. PAT → `GET /_apis/connectionData` → GUID dell'identità.
2. `iterations` → `changes` → `blobs` → diff renderizzato in Monaco.
3. `POST /threads` con ancoraggio: **round-trip del mapping line/offset** verificato nella UI AZDO nativa, su entrambi i lati del diff.
4. `PUT /reviewers/{guid}` con `vote = -5` e `vote = 10`.
5. **Le policy dell'org resettano i voti dopo un push?** (opzione *"Reset code reviewer votes"* sulla policy dei reviewer minimi, nelle due varianti *approval-only* / *all votes*) → conferma la scelta di §11 e la severità del reset per il `vote` finale.
