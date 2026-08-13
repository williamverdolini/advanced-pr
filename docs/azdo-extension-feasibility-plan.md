# Advanced PR Review, Estensione Azure DevOps

**Piano di fattibilità e di implementazione**

> Documento di lavoro. Implementazione avviata: scaffolding M1 e primo percorso verticale M3–M7 presenti; validazione live M0 ancora necessaria.
> Opzione architetturale: **web extension nativa di Azure DevOps** (tab "Advanced PR" dentro la pagina della pull request).
> Le label dell'applicazione sono **solo in inglese**; questo documento è in italiano.
> Ultimo aggiornamento: 2026-08-13.

---

## 0. Decisioni prese

| Tema | Decisione | Dettaglio |
|---|---|---|
| **Framework UI** | **React + TypeScript + `azure-devops-ui`** | Aspetto nativo di Azure DevOps gratis, stack dei sample ufficiali Microsoft. Il codice non-UI (parser, motore step, client) resta framework-agnostico (§8.1) |
| **Riconoscimento del piano** | **Marker esplicito + autore autorizzato** | Il thread deve contenere un marker `advanced-pr:v2` ed essere creato dall'autore della PR o da un bot configurato. Senza piano valido → un solo step `Everything else` (§4.1) |
| **Stato della review** | **Un thread-ledger per versione del piano** | Le azioni dei reviewer sono reply append-only con `eventId`; un reducer deterministico ricostruisce lo stato senza database (§5.1–§5.2) |
| **Approvazione della PR** | **Comando esplicito separato dagli step** | Approvare `Everything else` non vota automaticamente la PR. `Approve pull request` è disponibile dopo il completamento degli step (§5.3) |
| **Rifiuto di uno step** | **Due azioni distinte** | *Request changes on step* → `vote -5` (Waiting for author, reversibile). *Reject entire PR* → `vote -10`, azione distruttiva separata con conferma (§5.6) |
| **Presentazione dei thread nel diff** | **Thread inline dentro l'editor, pannello laterale rimosso** | Tutti i thread del file sono montati come view zone interattive; i thread senza anchor stanno in una zona fissa sopra la prima riga (§7.4) |
| **Navigazione e guardrail** | **Navigazione libera, guardrail non bloccanti** | File "viewed" informativo; step vuoti non richiedono approvazione; thread aperti producono warning e conferma prima del sign-off (§5.3) |

---

## 1. Verdetto di fattibilità

**Fattibile, con un rischio tecnico concentrato in un solo punto** (il diff viewer nell'iframe, §7).

Il fattore decisivo a favore di questa opzione è che **non serve alcun backend**: l'estensione è una SPA statica impacchettata nel `.vsix`, servita dalla CDN del Marketplace, che chiama le REST API di Azure DevOps **direttamente dal browser, con l'identità dell'utente collegato**. La documentazione ufficiale è esplicita:

> *"Most extensions call Azure DevOps REST APIs on behalf of the current user."*
>: [Authenticate and secure web extensions](https://learn.microsoft.com/en-us/azure/devops/extend/develop/auth?view=azure-devops)

Conseguenze dirette sui requisiti:

- I commenti e i voti sono **automaticamente attribuiti al reviewer reale**. Nessun PAT da gestire, nessun service account, nessun vault di credenziali.
- Nessun server applicativo da ospitare e nessuna credenziale utente persistita dall'estensione. Restano necessarie la review degli scope, delle dipendenze client e del codice distribuito nell'iframe.
- Nessun problema di CORS: le chiamate partono da un iframe che il prodotto stesso autorizza.

| Requisito | Fattibilità | Note |
|---|---|---|
| Tab "Advanced PR" nella pagina PR | ✅ Certa | Contribution point ufficiale `ms.vss-code-web.pr-tabs` (§3.1) |
| Lettura PR, reviewer, voti, work item | ✅ Bassa | REST 7.1 |
| Checks + build collegate | ✅ Bassa | Unione di 3 fonti: statuses + policy evaluations + builds (§6.4) |
| Parsing del piano e motore a step | ✅ Bassa | Logica interamente nostra, codice puro, unit-testabile |
| Lista file ridotta per step | ✅ Bassa | `iterations/{id}/changes` filtrato dal piano di step |
| **Diff viewer con commenti ancorati alla riga** | 🟡 **Rischio principale** | Monaco dentro l'iframe (web worker, bundle) + mapping riga/offset verso AZDO (§7, §11) |
| Commenti: lettura, reply, like | ✅ Bassa | API threads + `pull-request-comment-likes` (verificata) |
| Approvazione/rifiuto di step | ✅ Bassa | Protocollo di commenti con marker (§5) |
| Approvazione finale = voto AZDO | ✅ Bassa | `PUT reviewers/{id}` con `vote: 10` |
| Ripresa "dove ero rimasto" | ✅ Bassa | Deriva dai marker, nessuno stato da persistere (§5.4) |
| Distribuzione al team | ✅ Bassa | Estensione **privata** condivisa con l'org (§9) |

I rischi principali sono due: Monaco nell'iframe e la correttezza del protocollo distribuito basato sui commenti. Se Monaco non supera lo spike (§11-R1), si ripiega su un renderer leggero che deve comunque preservare selezione e ancoraggio dei commenti. Il protocollo v2 va provato con concorrenza, retry e modifiche del piano prima di costruire la UI completa.

---

## 2. Perché questa opzione (e cosa costa)

Rispetto a un'applicazione web autonoma che parla con Azure DevOps dall'esterno:

**Vantaggi**
- Zero infrastruttura, zero autenticazione da progettare, zero manutenzione operativa.
- L'utente resta *dentro* Azure DevOps: nessun context switch, nessun secondo login, il link "torna alla PR classica" è banale (è la stessa pagina, altro tab).
- Adozione naturale: l'estensione appare dove la gente già lavora.
- Tema chiaro/scuro, font e larghezza ereditati dall'host.

**Svantaggi / vincoli da accettare**
- Si vive **dentro un iframe**: niente routing di primo livello, spazio verticale condiviso con l'header della PR, altezza da gestire.
- Tutto è client-side: niente cache condivisa fra utenti, niente job schedulati, niente notifiche push. Ogni utente ricarica i dati per sé.
- Il ciclo di sviluppo passa dal Marketplace (mitigato dal trucco `baseUri` su localhost, §8.2).
- Il diff (calcolo e rendering) è a carico del browser: su file molto grandi serve virtualizzazione e soglie.
- Aggiornare l'estensione significa ripubblicare un `.vsix` (aggiornamento poi automatico per le org che l'hanno installata).

**Fuori dalla v1:** dashboard trasversale alle PR, supporto GitHub, audit e notifiche centralizzati, auto-complete e modifica/cancellazione di file-map nella branch. Se uno di questi diventa un requisito reale, si può aggiungere un backend opzionale senza spostare fuori dall'estensione il flusso di review.

---

## 3. Anatomia dell'estensione

### 3.1 Contribution point

Verificato sulla documentazione ufficiale ([Extensibility Points](https://learn.microsoft.com/en-us/azure/devops/extend/reference/targets/overview?view=azure-devops)):

| Nome | Target ID |
|---|---|
| **Git pull request tabs (pivots)** | **`ms.vss-code-web.pr-tabs`** |
| Git pull request actions menu | `ms.vss-code-web.pull-request-action-menu` |

Manifest (`vss-extension.json`), forma prevista:

```jsonc
{
  "manifestVersion": 1,
  "id": "advanced-pr",
  "publisher": "<publisher-id>",
  "version": "0.1.0",
  "name": "Advanced PR Review",
  "description": "Step-based pull request review inside Azure DevOps.",
  "categories": ["Azure Repos"],
  "icons": { "default": "images/icon.png" },
  "targets": [{ "id": "Microsoft.VisualStudio.Services" }],
  "scopes": ["vso.code_write", "vso.threads_full", "vso.build", "vso.work"],
  "contributions": [
    {
      "id": "advanced-pr-tab",
      "type": "ms.vss-web.tab",
      "targets": ["ms.vss-code-web.pr-tabs"],
      "properties": {
        "name": "Advanced PR",
        "title": "Advanced PR",
        "uri": "dist/tab/index.html"
      }
    }
  ],
  "content": { "details": { "path": "overview.md" } },
  "files": [
    { "path": "dist", "addressable": true },
    { "path": "images/icon.png", "addressable": true },
    { "path": "overview.md" }
  ]
}
```

> Nota dalla documentazione: `icon` / `iconName` **non funzionano** per le contribution di tipo tab.
> Questo è un manifest di riferimento: M0 deve validarlo con `tfx extension create` prima della pubblicazione.

### 3.2 Scope candidati

Estratti dal [Manifest Reference](https://learn.microsoft.com/en-us/azure/devops/extend/develop/manifest?view=azure-devops):

| Scope | Perché serve |
|---|---|
| `vso.code_write` | Leggere PR, iterazioni, file, blob; **creare thread e commenti**; **votare** (approve/reject). È lo scope che copre "create and manage pull requests and code reviews" |
| `vso.threads_full` | *"Grants the ability to read and write to pull request comment threads."*: necessario per i thread e le reazioni |
| `vso.build` | Build collegate alla PR (requisito "stati delle compilazioni collegate") |
| `vso.work` | Work item collegati alla PR; escluso dalla v1 se il requisito non viene confermato |

⚠️ Gli scope sono mostrati all'utente/admin al momento dell'installazione: **tenerli al minimo** è una scelta di adozione, non solo di sicurezza. `vso.code_write` è già "read and write source code" e può sollevare domande in fase di approvazione: da preparare una riga di spiegazione per l'admin (§9.4).
⚠️ Un cambio di scope invalida il certificato dell'estensione e richiede il ri-consenso all'installazione.

Lo spike M0 deve verificare lo scope minimo **endpoint per endpoint**. La tabella è il set candidato, non un'autorizzazione definitiva a richiedere tutti gli scope.

### 3.3 Come il tab riceve il contesto della PR

Il contratto delle tab contribution (documentato per le query tabs, identico per le PR tabs):

```javascript
SDK.register(SDK.getContributionId(), {
    pageTitle:     function(state) { return "Advanced PR"; },
    updateContext: function(tabContext) { /* qui arriva il contesto */ },
    isInvisible:   function(state) { return false; },
    isDisabled:    function(state) { return false; }
});
```

Più `SDK.getConfiguration()`, `SDK.getWebContext()` (org, project, team, utente corrente) e `SDK.getPageContext()`.

🔎 **Da verificare nello spike (§13):** la forma esatta di `tabContext` per `pr-tabs`, se contiene `pullRequestId` e `repositoryId` direttamente. Il fallback deve usare soltanto API SDK o configurazione documentata; il parsing della route dell'host è fragile e non va considerato un contratto supportato.

### 3.4 Dove vive lo stato

**Nessun database. Azure DevOps è l'unica fonte di verità.**

| Dato | Dove |
|---|---|
| Piano degli step | Thread generale autorizzato e versionato nella PR (§4) |
| Approvazioni di step | Reply evento nel thread-ledger del piano (§5) |
| Approvazione della PR intera | `reviewers[].vote` della PR |
| Commenti, reply, like | Thread AZDO |
| Preferenze UI (side-by-side/inline, whitespace, file "visti") | `ExtensionDataService` dell'SDK, documento **per-utente**: opzionale, degradabile a `localStorage` |

Questo rende l'app **stateless e riavviabile**, e soprattutto: chi usa la UI classica di Azure DevOps vede comunque tutto (i commenti di approvazione sono commenti veri).

---

## 4. Il piano di review: formato e parsing

### 4.1 Come lo riconosciamo

**Decisione (§0): marker esplicito e autore autorizzato, nessuna euristica.**

Il piano è un thread generale della PR il cui primo commento contiene un marker versionato:

```markdown
<!-- advanced-pr:v2 {"kind":"review-plan","planId":"550e8400-e29b-41d4-a716-446655440000","version":1} -->
```

- Sono candidati soltanto thread generali creati dall'**autore della PR** o da identità bot configurate. Marker di altri utenti vengono ignorati con warning di sicurezza.
- **Nessun piano autorizzato** → un solo step `Everything else` con tutti i file. (Requisito esplicito.)
- Fra versioni dello stesso `planId` vince la `version` più alta; `publishedDate` e `commentId` risolvono soltanto un pareggio anomalo.
- Un nuovo `planId` autorizzato sostituisce il precedente e produce un warning esplicito.
- I marker legacy `<!-- advanced-pr:steps -->` sono leggibili in modalità compatibilità, con `planId` e versione sintetici, ma l'estensione scrive soltanto v2.

Conseguenza da accettare consapevolmente: se l'autore dimentica il marker, la PR degrada a step unico. È il prezzo di avere zero falsi positivi, ed è un comportamento prevedibile e spiegabile.

**Mitigazioni previste** (economiche, riducono quasi a zero il fastidio):
- Un **pulsante "Copy template"** nel tab quando non viene trovato alcun piano: copia negli appunti lo scheletro del commento (marker già incluso e file della PR pre-elencati) pronto da incollare nella PR.
- Il testo dello stato vuoto dice **perché** si vede un solo step, non solo che lo si vede.

⚠️ **Da valutare in M3:** il marker deve essere scritto dal processo che genera il piano o dall'estensione. Un pulsante "Create review plan" eliminerebbe il rischio di marker malformati, ma amplia la v1. Vedi Q16 in §12.

### 4.2 Grammatica (tollerante)

```
1. Core
### Explain
Partire da `engine.ts`: il resto ne discende.
- path/file/1
- path/file/2

2. Tests
- path/file/4

2. Public API
- path/file/6
```

- **Intestazione di step**: riga che inizia con `N.` / `N)` / `## N.` / `## Titolo`. Il titolo è il testo dopo il numero, trim.
- ⚠️ **Il numero è decorativo, non ordinante.** Nell'esempio fornito nei requisiti compaiono **due sezioni numerate `2.`** ("Tests" e "Public API"). Gli step vanno ordinati per **posizione nel documento**, ignorando il numero: rende il commento robusto a copia-incolla, riordini e refusi.
- **Blocco `Explain` (opzionale)**: una riga `### Explain` (qualsiasi livello di heading, maiuscole indifferenti, due punti finali ammessi) apre note descrittive per lo step. Il blocco finisce alla **prima voce file** o alla sezione successiva. Le voci puntate **indentate** restano dentro la spiegazione: è la via di fuga per scrivere un elenco senza che venga letto come lista di file. Il contenuto è Markdown ed è mostrato in un pannello collassabile sopra "Changed files". **Non entra nella struttura canonica**: modificarlo non cambia `planHash` né i `fingerprint`, quindi non invalida le approvazioni già date.
- **Voce file**: riga che inizia con `-`, `*` o `+`. Path normalizzato: rimozione di backtick e di sintassi link markdown, rimozione di `./` e `/` iniziali, `\` → `/`, confronto **case-insensitive** (Git è case-sensitive ma i path incollati a mano spesso no → confrontare in modo tollerante e segnalare).
- Righe vuote e testo libero fra le voci: **ignorati** (così l'autore può scrivere note descrittive dentro il commento).
- **Duplicati fra step**: vince la **prima** occorrenza, warning visibile.
- **Titoli duplicati**: consentiti solo con warning; l'identità dello step non deriva dal titolo.
- **Step vuoti**: mostrati come informativi e non richiedono approvazione.
- **Path elencati ma non presenti nella PR**: warning "stale entry" (indica un piano non aggiornato dopo un push).
- **Path presenti nella PR ma non elencati** → confluiscono nello step finale.
- **Lo step finale `Everything else` esiste sempre**, anche se vuoto, ma non ha semantica speciale di voto.
- **Case collision**: path che differiscono solo per maiuscole/minuscole producono un errore ambiguo, non un match silenzioso.
- **Rename/delete**: sono normalizzati come cambi che coinvolgono il vecchio e/o il nuovo path (§5.5).

### 4.3 Output del parser

```
StepPlan {
  planId,
  version,
  steps:    [ ReviewStep { stepId, order, title, isCatchAll, files[], fingerprint } ],
  warnings: [ DuplicatePath, DuplicateTitle, StaleEntry, CaseCollision, NoPlan, UnauthorizedPlan ],
  sourceThreadId,
  planHash          // hash della struttura canonica, non del Markdown originale
}
```

Il parser produce prima una struttura canonica: path normalizzati, step ordinati per posizione e file ordinati in modo deterministico. `stepId`, `fingerprint` e `planHash` derivano da questa struttura; testo descrittivo e formattazione non li cambiano. Modifiche a titolo, ordine o file creano invece una nuova versione logica. Il parser è **codice puro senza I/O** e va coperto con casi su numeri ripetuti, path strani, Markdown sporco, rename/delete, case collision e modifiche cosmetiche.

---

## 5. Protocollo di approvazione per step

Azure DevOps **non ha** il concetto di step: il voto è **un solo valore per reviewer sull'intera PR**. Serve quindi un protocollo, e il requisito lo suggerisce già: usare i commenti.

### 5.1 Un thread-ledger per versione del piano

Il thread che contiene il piano è anche il **ledger append-only** della sua versione. Approvazioni, richieste di modifica e decisioni PR sono reply nello stesso thread. Non si crea un thread lazy per ogni step: così due reviewer concorrenti non possono creare due contenitori autorevoli per lo stesso step.

**Senza piano il ledger esiste comunque.** Una PR senza piano autorizzato ha pur sempre uno step revisionabile (`Everything else` con tutti i file) e quello step va trattato come qualunque altro, senza logiche speciali. Il primo evento registrato apre quindi un thread generale che fa da ledger, e gli eventi successivi vi si accodano. La lettura raccoglie gli eventi da **tutti** i thread generali, non solo da quello del piano: l'autorità di un evento non è mai dipesa da dove sta, ma dall'autore Azure DevOps del commento e dalla corrispondenza con `planId`, versione e `planHash` correnti. Quando l'autore pubblica un piano vero, gli eventi del piano sintetico smettono di corrispondere e decadono da soli.

Chi usa la UI classica vede un log umano delle decisioni; l'estensione ricostruisce lo stato dai marker senza database. Se il thread viene cancellato, chiuso in modo incompatibile o reso non leggibile, la review entra in sola lettura finché il piano non viene ripristinato o sostituito esplicitamente.

### 5.2 Formato del marker

```markdown
✅ **Step approved: `Core`** (step 1 of 4) · iteration 3

<!-- advanced-pr:v2 {"kind":"step-approved","eventId":"7bb0d4c8-0b10-49e9-85b7-55f335494f49","planId":"550e8400-e29b-41d4-a716-446655440000","planVersion":1,"planHash":"a1b2c3d4","stepId":"step-9f42","iteration":3,"stepFingerprint":"f4e1a920"} -->
```

- La prima riga è **leggibile da un umano** anche nella UI classica di Azure DevOps.
- L'HTML comment è la parte **leggibile dalla macchina**, ed è invisibile nel markdown renderizzato.
- `eventId` rende idempotenti retry e doppio click.
- L'identità del reviewer deriva sempre dall'**autore Azure DevOps del commento**, mai dal JSON.
- `kind` previsti: `step-approved`, `step-changes-requested`, `step-reset`, `pr-approved`, `pr-rejected`.

Il reducer:

1. accetta solo eventi con `planId`, versione e `planHash` correnti;
2. deduplica per `eventId`;
3. ordina per `publishedDate` e, a parità, per `commentId`;
4. applica l'ultimo evento per `(reviewerId, stepId)` e l'ultima decisione esplicita a livello PR.

Dopo un timeout di scrittura, il client rilegge il ledger e cerca lo stesso `eventId` prima di ritentare. Reply concorrenti sono ammesse e duplicati identici non cambiano lo stato.

🔎 **Da verificare nello spike (§13):** che Azure DevOps non elimini né mostri gli HTML comment nei commenti PR. Se li sanitizzasse, il fallback è una riga visibile in code-span: meno elegante, funzionalmente identico.

### 5.3 Approvazione esplicita della PR

`Approve step` registra soltanto l'evento dello step. Quando tutti gli step non vuoti della versione corrente sono approvati dal reviewer e nessuno è `ChangesRequested`, la UI abilita il comando distinto **Approve pull request**:

1. mostra un dialog con riepilogo (*"You are approving the whole pull request) 4 steps, 127 files"*;
2. se esistono thread aperti creati dall'utente, mostra un warning confermabile, non un blocco;
3. scrive l'evento `pr-approved` nel ledger;
4. chiama `PUT .../pullRequests/{id}/reviewers/{myId}` con `vote: 10`.

L'approvazione di `Everything else` non vota automaticamente la PR. File "viewed" e ordine di navigazione sono informativi: l'utente può muoversi liberamente fra gli step.

### 5.4 Ripresa della sessione ("dove ero rimasto")

All'apertura del tab:

1. Carica PR → iterazione corrente → file modificati → piano autorizzato → `StepPlan`.
2. Carica il thread-ledger ed estrae gli eventi v2.
3. Valida piano/hash, deduplica e riduce gli eventi (§5.2).
4. **Step suggerito = il primo step non vuoto senza approvazione dell'utente corrente**, senza impedire la navigazione libera.
5. Se sono tutti approvati → schermata di sign-off con stato del voto e comando esplicito (§5.3).

Nessuna persistenza: lo stato si ricalcola ogni volta dai commenti. È il punto più elegante di questo design.

### 5.5 Invalidazione dopo un nuovo push

Ogni push crea una nuova **iterazione**. Ogni approvazione porta `iteration`, `planHash` e `stepFingerprint`, quindi:

- se i file di quello step **non** sono cambiati fra le due iterazioni → approvazione ancora valida, badge *"approved at iteration 3"*;
- se sono cambiati → badge **"needs re-review"** e lo step torna attivo;
- file aggiunti e non assegnati invalidano `Everything else`;
- rename coinvolge vecchio e nuovo path, delete il vecchio path;
- se cambia la struttura canonica del piano (`planHash` diverso) gli eventi precedenti diventano storici; una modifica solo cosmetica mantiene le approvazioni.

Il confronto usa `GET iterations/{new}/changes?$compareTo={old}` e deve seguire tutte le pagine della risposta. Se il piano corrente scompare o non è più autorizzato, la UI resta in sola lettura: non degrada silenziosamente a un nuovo catch-all approvabile.

### 5.6 Rifiuto di uno step

**Decisione (§0): si implementano entrambe le azioni.**

Il requisito diceva "Rigettare lo step: questo si può tradurre nel reject della PR in AZDO", ma `vote: -10` (Rejected) è uno stato **globale e molto pesante** sulla PR, spesso bloccante per le policy: rifiutare il primo di cinque step manderebbe l'intera PR in Rejected. Si separano quindi i due gesti:

| Azione UI | Effetto su AZDO | Peso visivo |
|---|---|---|
| **Request changes on step** | `vote: -5` (*Waiting for author*) + marker `step-changes-requested` | pulsante secondario, accanto ad "Approve step" |
| **Reject entire PR** | `vote: -10` (*Rejected*) + marker `pr-rejected` | azione distruttiva, separata, con conferma |

Il voto `-5` è **reversibile**, ma non alla semplice approvazione di un altro step: resta finché almeno uno step corrente del reviewer è `ChangesRequested`. Tornare a `0` richiede un comando esplicito quando nessuna richiesta di modifica resta; `vote 10` richiede sempre **Approve pull request** (§5.3).

L'estensione non sovrascrive automaticamente voti `5`, `10` o `-10` espressi nella UI classica. Ogni modifica del voto globale avviene soltanto in risposta a un comando esplicito dell'utente.

In entrambi i casi la UI deve dire esplicitamente cosa succede al voto globale (*"your PR vote is now Waiting for author"*) perché è l'unico punto in cui la finzione degli step tocca uno stato reale e condiviso della PR.

### 5.7 Macchina a stati di uno step (per reviewer)

```
NotStarted ──apri──► InReview ──approve──► ApprovedByMe ──(push sui file dello step)──► NeedsReReview
                        │  ▲                                                                  │
  request changes  │  │ reset / nuova review                                             │
                        ▼  │                                                                  │
                 ChangesRequested ◄────────────────────────────────────────────────────────────┘
```

Stato aggregato mostrato per step: `approvedBy[]`, `changesRequestedBy[]`, `openThreadCount`, `approvedAtIteration`.

---

## 6. Mappa requisito → API Azure DevOps

Base: `https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repoId}`, `api-version=7.1`.
In pratica queste chiamate si fanno tramite i client tipizzati di [`azure-devops-extension-api`](https://github.com/microsoft/azure-devops-extension-api) (`GitRestClient`, `BuildRestClient`, `PolicyRestClient`), che gestiscono il token da soli.

### 6.1 Informazioni della PR

| Scopo | Endpoint |
|---|---|
| Dettaglio PR (include `reviewers[]` con i voti, `_links.web` per il link ad AZDO) | `GET /pullRequests/{prId}` |
| Iterazioni (ogni push = un'iterazione) | `GET /pullRequests/{prId}/iterations` |
| File modificati in un'iterazione | `GET /pullRequests/{prId}/iterations/{it}/changes?$top=2000&$compareTo={base}` seguendo la paginazione |
| Work item collegati | `GET /pullRequests/{prId}/workitems` |
| Utente corrente | `SDK.getWebContext().user` (nessuna chiamata REST) |

Il **link alla PR classica** è `pullRequest._links.web.href`: requisito soddisfatto con un campo già presente nella risposta.

### 6.2 Contenuto dei file per il diff

| Scopo | Endpoint |
|---|---|
| Blob per objectId (**content-addressed → cacheabile per sempre**) | `GET /blobs/{objectId}?$format=text` |
| Contenuto per path+commit (alternativa) | `GET /items?path={p}&versionDescriptor.version={sha}&versionDescriptor.versionType=commit&includeContent=true` |

Gli `objectId` di sorgente e destinazione arrivano già dentro `iterations/{it}/changes`. Il diff **non lo chiediamo ad Azure DevOps**: lo calcola Monaco lato client confrontando i due contenuti (§7).

### 6.3 Commenti

| Scopo | Endpoint |
|---|---|
| Lista thread | `GET /pullRequests/{prId}/threads` |
| **Thread ancorato a codice** | `POST /pullRequests/{prId}/threads` con `threadContext.filePath` + `rightFileStart/End {line, offset}` e `pullRequestThreadContext.iterationContext {firstComparingIteration, secondComparingIteration}` |
| **Thread generale** (piano + ledger) | `POST /pullRequests/{prId}/threads` **senza** `threadContext` |
| Reply | `POST /pullRequests/{prId}/threads/{tId}/comments` |
| Edit / delete commento | `PATCH` / `DELETE /pullRequests/{prId}/threads/{tId}/comments/{cId}` |
| Resolve / riapri thread | `PATCH /pullRequests/{prId}/threads/{tId}` (`status: active\|fixed\|wontFix\|closed\|byDesign\|pending`) |
| **Like** (verificato: Create / Delete / List) | `PUT` / `DELETE` / `GET /pullRequests/{prId}/threads/{tId}/comments/{cId}/likes` |

⚠️ Senza `pullRequestThreadContext.iterationContext`, Azure DevOps non riesce a "seguire" il commento nelle iterazioni successive e nella UI nativa il commento appare *outdated*. Va popolato correttamente.

### 6.4 Checks e build collegate

I check verdi che si vedono nella UI di Azure DevOps sono l'**unione di tre fonti diverse**, da comporre in un solo elenco:

| Fonte | Endpoint |
|---|---|
| PR statuses | `GET /pullRequests/{prId}/statuses` |
| **Policy evaluations** (sono i check delle branch policy, **non** presenti in `statuses`) | `GET https://dev.azure.com/{org}/{project}/_apis/policy/evaluations?artifactId=vstfs:///CodeReview/CodeReviewId/{projectId}/{prId}` |
| Build collegate | `GET https://dev.azure.com/{org}/{project}/_apis/build/builds?...` |

Ogni risultato porta `source` (status/policy/build) e `isBlocking`. Un errore di recupero va mostrato come *"unable to retrieve checks"*, **mai** come *"no checks"*: la differenza fra "non ci sono controlli" e "non sono riuscito a leggerli" è di sicurezza.

### 6.5 Voto

| Scopo | Endpoint |
|---|---|
| Voto del reviewer | `PUT /pullRequests/{prId}/reviewers/{identityId}` con `{ "vote": n }` |

Valori: `10` approved · `5` approved with suggestions · `0` no vote · `-5` waiting for author · `-10` rejected.

---

## 7. Diff viewer: la parte delicata

### 7.1 Opzione raccomandata: Monaco DiffEditor

Azure DevOps stesso usa Monaco. Con `MonacoDiffEditor` si ottengono gratis: calcolo del diff, side-by-side e inline, syntax highlighting, folding delle parti invariate, e le API `deltaDecorations` / `revealLineInCenter` che servono per marcare le righe commentate.

**Rischi concreti** (chiudibili solo con uno spike):
- **Web worker.** Monaco calcola il diff in un worker (`editorWorkerService`). L'iframe dell'estensione è servito dalla CDN del Marketplace: va verificato che il worker si carichi (worker dal medesimo origin dei file addressable, oppure blob URL) e che nessuna CSP lo blocchi. **Senza worker, il DiffEditor non calcola il diff.**
- **Bundle size.** Monaco pesa; va limitato ai linguaggi realmente usati e servito dai file dell'estensione (il limite del pacchetto `.vsix` è 50 MB, quindi non è un problema di limite ma di tempo di caricamento nell'iframe).

### 7.2 Piano B: renderer di diff leggero

`jsdiff` (calcolo in un worker nostro) + rendering custom o `diff2html`, con `highlight.js` per la colorazione. Si perde il livello di rifinitura di Monaco, si guadagnano semplicità e controllo. Il fallback deve preservare selezione, mapping left/right e ancoraggio dei commenti: non basta mostrare il diff. **Da tenere pronto come alternativa, non come scelta iniziale.**

### 7.3 Commenti ancorati: il mapping

È il secondo rischio tecnico (§11-R2). Serve tradurre in modo affidabile:

```
selezione in Monaco  ──►  threadContext { filePath, rightFileStart {line, offset}, rightFileEnd {...} }
                          + pullRequestThreadContext.iterationContext
```

Punti da verificare con un round-trip reale contro la UI nativa di Azure DevOps:
- Monaco usa righe e colonne **1-based**; l'`offset` di Azure DevOps sembra 1-based: **da confermare**.
- Va tracciato il **lato del diff**: i commenti sulla versione base usano `leftFileStart/End`, non `rightFileStart/End`.
- Su una PR con **più iterazioni**, l'ancoraggio va verificato anche a distanza di un push.

### 7.4 Presentazione dei thread: inline dentro l'editor

**Il pannello laterale è stato rimosso.** L'area del file è l'unico posto dove si leggono e si gestiscono i commenti, come nella sezione Files nativa:

- **Tutti** i thread del file sono montati contemporaneamente come view zone sotto la riga ancorata, lato left o right; la treeview li espone come figli del file e ne condivide `selectedThreadId`.
- I thread **senza anchor valido** (commenti a livello file, commenti resi orfani da un push) finiscono in una **zona fissa sopra la prima riga**, con le stesse azioni: non esiste uno stato in cui un commento è invisibile nel diff.
- Reply, like, resolve/reopen e composer di un nuovo thread vivono dentro la zona. Ogni card ha il proprio stato di pending ed errore: una reply fallita non azzera la review.
- Il **glyph margin** è l'affordance di scrittura: su una riga commentata il click seleziona il thread, su una riga libera mostra un `+` e apre il composer. Se il click cade dentro una selezione attiva, viene ancorato l'intero range invece della singola riga.

**Markdown dei commenti: renderizzato, non incollato.** Il testo dei commenti è **contenuto scritto da altri utenti**, mostrato dentro un iframe che detiene il token dell'utente corrente: renderizzarlo come HTML aprirebbe una XSS con un bersaglio di valore. Per questo `core/markdown.ts` produce un albero di valori e `components/Markdown.tsx` lo trasforma in **elementi React**, senza `dangerouslySetInnerHTML` da nessuna parte: l'iniezione di markup è impossibile per costruzione, non per sanitizzazione. Gli URL passano da una allowlist di schemi (`http`, `https`, `mailto`, path relativi): un `javascript:` resta testo. Il sottoinsieme coperto è quello che la toolbar dell'editor sa produrre (grassetto, corsivo, code span e blocchi, link, citazioni, liste, heading), unit-testato.

L'editor mostra una **preview live** sotto il campo appena c'è del testo, e un commento può essere **modificato dal suo autore** (`updateComment`); il comando compare solo sui propri commenti, e comunque il servizio lo impone lato server.

**Tipo di modifica.** `changeType` di Azure DevOps è un enum di flag (un rename arriva come `Rename | Edit`, un undelete come `Undelete | Add`), quindi la classificazione è a bit in `core/changeType.ts`, unit-testata sulle combinazioni reali. Il risultato guida due cose: l'indicatore nella treeview (`+` aggiunto, `±` modificato, `−` eliminato, `→` rinominato, con etichetta accessibile) e la modalità del visualizzatore.

**File a un solo lato: nessun diff.** Un file **aggiunto** non ha contenuto base e uno **eliminato** non ha contenuto nuovo: entrambi vengono mostrati in un editor singolo read-only (`monaco.editor.create` invece di `createDiffEditor`), il primo con il contenuto nuovo, il secondo con quello che il file conteneva. Il rename resta in diff, dove il confronto ha significato. `EditorHandle` incapsula la differenza, così zone, decorazioni, glyph margin e commenti hanno **un solo percorso di codice**; il selettore di layout sparisce dove non ha senso.

Il modello delle zone non ragiona più in termini di "side-by-side sì/no" ma di **lati effettivamente a schermo** (`visibleSides`): diff affiancato `["left","right"]`, diff unificato `["right"]`, file aggiunto `["right"]`, file eliminato `["left"]`. Un thread ancorato a un lato non visibile finisce nella zona sopra il file. Su un file eliminato tutti i commenti stanno sul lato base, quindi senza questa generalizzazione sarebbero finiti **tutti** nella zona in cima invece che sulle loro righe.

⚠️ **I file eliminati devono comparire nella treeview.** Il path di una voce di change non arriva sempre da `item.path`: la risoluzione consulta anche `sourceServerItem` e `originalPath`, e le cartelle vengono escluse. Inoltre un file eliminato porta lo **`objectId` nullo di Git** (40 zeri), che è *truthy*: passato a `getBlobContent` produce un errore di rete invece di un contenuto vuoto, quindi va trattato come assente.

**Separatore ridimensionabile.** Tra treeview e visualizzatore c'è lo `Splitter` di `azure-devops-ui`, lo stesso componente della sezione Files nativa: produce il medesimo `role="separator"` con `aria-valuenow`/`aria-valuetext` e supporta il trascinamento e le frecce da tastiera. La treeview è l'elemento fisso (280px iniziali, 180–720), il diff assorbe lo spazio restante. È un altro punto in cui usare il componente della libreria vale più che riscriverlo (§8.1).

**Layout del diff: inline di default, side-by-side a scelta dell'utente.** Il selettore sta sopra l'editor e cambia solo `renderSideBySide` via `updateOptions`, senza ricreare l'editor. Vincolo da conoscere: nella vista inline Monaco **non renderizza l'editor originale**, quindi un thread ancorato al lato base non ha una riga sotto cui stare. In quel caso confluisce nella zona sopra il file (con la sua etichetta `Base · line N`) e il messaggio invita a passare a side-by-side per vederlo in posizione. Mappare le righe base sulla vista unificata richiederebbe il risultato del diff di Monaco (`getLineChanges`) ed è un affinamento separato.

**Il modello delle zone è codice puro** (`core/inlineZones.ts`, unit-testato): decide chiavi, lato, riga e cap. La chiave contiene il path del file, quindi cambiare file sostituisce tutte le zone; a parità di chiave la zona (e con essa lo stato React che contiene) sopravvive a un refresh.

Guardrail e vincoli imparati implementandolo:

- **Refresh granulare obbligatorio.** Ricaricare l'intero workspace dopo una reply ricostruiva l'editor Monaco e i blob. Le azioni sui commenti rileggono soltanto i thread (`refreshThreads`) e conservano l'identità di `files`.
- **Le zone si riconciliano, non si ricreano.** L'effetto confronta chiavi desiderate e montate; un cambio di riga o di lato **sposta** la zona riusando gli stessi nodi DOM. Ricrearle a ogni render cancellerebbe la reply in scrittura.
- **Altezza guidata da `ResizeObserver`** su un wrapper interno (il nodo esterno è di proprietà di Monaco, misurarlo sarebbe circolare) → `layoutZone`. Il calcolo una-tantum non regge reply, collapse e testo che va a capo.
- **Una zona non va mai creata con altezza 0.** Monaco mette `display: none` alle whitespace che non considera visibili (`viewZones.js`, `render()`); un elemento non renderizzato non ha box, quindi `ResizeObserver` non emette mai e la zona resta collassata **in modo irreversibile**. L'effetto secondario è il peggiore: `getZoneAtCoord` non riconosce più l'area come view zone, i click finiscono sul codice sottostante e Monaco avvia una drag-selection, la card sembra "morta". Si parte da un'altezza provvisoria e si ignorano le misurazioni a 0.
- **Tema.** Azure DevOps applica il tema come variabili CSS sul `body`; il tema di Monaco viene derivato dalla luminanza di `--background-color` (`core/theme.ts`, unit-testato) e riapplicato con un `MutationObserver`, senza dipendere dai nomi delle classi interne dell'host. Lo sfondo della striscia attorno alla card è trasparente, così resta quello dell'editor e non quello della pagina.
- **Contenimento della tastiera.** La zona vive dentro il DOM dell'editor: senza `stopPropagation` sui key event nativi, digitare in una reply pilota Monaco (frecce, Ctrl+F). Conseguenza accettata: React delega gli eventi a `document`, quindi **i componenti dentro una zona non possono usare handler React da tastiera**, gli shortcut vanno registrati nativamente sul contenitore.
- **La zona deve avere `z-index`.** `.view-lines` è dimensionato all'intera area di scroll (`viewLines.js`) e nel DOM viene **dopo** `.view-zones`: senza un ordine di impilamento esplicito copre la zona e ne intercetta tutti i click, pur restando la card perfettamente visibile. È lo stesso motivo per cui il widget interattivo di Monaco dichiara `.monaco-editor .zone-widget { position: absolute; z-index: 10 }`; usiamo lo stesso valore. Scrollbar e diff overview stanno anch'essi a 10 ma vengono dopo nel DOM, quindi vincono il pareggio e restano utilizzabili.
- **`suppressMouseDown` deve restare `false`.** Il nome inganna: con `true` Monaco fa `preventDefault` sul mouse down, **sposta il focus sulla propria textarea** e avvia una drag-selection (`mouseHandler.js`, ramo `targetIsViewZone`), rendendo i pulsanti e gli input della zona inutilizzabili. Con `false` quel ramo non viene eseguito e l'evento raggiunge il contenuto.
- **Cap esplicito** (60 zone per file): oltre la soglia i thread meno rilevanti restano raggiungibili dalla tree e il numero nascosto viene **dichiarato**, mai silenziosamente troncato.

### 7.5 Performance con 100+ file

- **Una sola istanza** di editor, riusata cambiando i model: non un editor per file.
- Lista file virtualizzata.
- Blob caricati **lazy**, con richieste annullate al cambio file, e cache LRU con limite per `objectId` (immutabile per costruzione).
- I Monaco model non più usati vengono esplicitamente eliminati.
- File binari e file oltre soglia (es. > 1 MB o > 5000 righe): non renderizzati, avviso e link alla PR classica.
- Encoding non supportato, file binario, file troppo grande ed errore di rete sono stati distinti.
- Il vantaggio strutturale è che **si carica un solo step per volta**: è esattamente il problema che l'app risolve.

M0 stabilisce soglie misurabili per tempo di apertura, cambio file e memoria su una PR realistica. Monaco resta la scelta solo se il worker parte senza violazioni CSP, gli ancoraggi fanno round-trip e la memoria si stabilizza dopo i cambi file.

---

## 8. Framework UI

### 8.1 La scelta

**Decisione (§0): React + TypeScript + `azure-devops-ui`.** Il confronto che ha portato alla scelta resta qui documentato.

| | **React + `azure-devops-ui`** ✅ scelto | **Angular** |
|---|---|---|
| SDK (`azure-devops-extension-sdk`) | vanilla JS, funziona | vanilla JS, **funziona identicamente** |
| REST clients (`azure-devops-extension-api`) | funzionano | **funzionano identicamente** |
| Libreria di componenti nativa | **`azure-devops-ui`** (Microsoft): Tab, Card, Button, Header, Table, Dropdown, Spinner, MessageCard, ZeroData, IdentityPicker | **nessuna**, da reimplementare, o usare Angular Material e accettare un look diverso |
| Tema chiaro/scuro dell'host | gestito dalla libreria | da fare a mano sulle CSS variables iniettate dall'host |
| Sample e documentazione ufficiale | [azure-devops-extension-sample](https://github.com/microsoft/azure-devops-extension-sample) è React | nessun sample ufficiale |
| Monaco | integrazione diretta | integrazione diretta (o `ngx-monaco-editor`) |
| Peso nell'iframe | minore | maggiore (framework + zone.js) |

**Il punto non è il framework, è la libreria di componenti.** L'SDK e le REST API sono JavaScript puro e non hanno alcuna preferenza. La differenza reale è che con React si eredita gratis l'aspetto nativo di Azure DevOps; con Angular va ricostruito.

Stima onesta del sovracosto Angular: **1–2 settimane-uomo** di lavoro puramente cosmetico (riscrittura di ~15 primitive UI + theming chiaro/scuro), più il rischio di un risultato che "si vede" che non è Azure DevOps, in un'app il cui scopo dichiarato è dare *"un'esperienza simile alla review fatta in AZDO"*.

**Mitigazione del fatto che React non è il framework che conosci meglio:** il codice che conta (parser e canonicalizzazione del piano, reducer degli eventi, motore degli step, client verso AZDO) è **completamente framework-agnostico** e va scritto in TypeScript puro, fuori dai componenti. React resta confinato al livello di presentazione. Questo ha tre effetti pratici: gli unit test non toccano React, la curva di apprendimento riguarda solo la UI, e un eventuale cambio di framework in futuro non rimette in discussione la logica.

### 8.1.1 Come si usano i token di tema dell'host

`azure-devops-ui` importa `Core/core.css` da ogni componente, quindi **le utility e le variabili di tema di Azure DevOps sono già nel bundle**: non va copiato nulla, va solo usato il formato giusto. Le variabili sono di **due specie diverse**, e confonderle non degrada l'aspetto, lo cancella:

| Specie | Contenuto | Uso corretto |
|---|---|---|
| `--palette-neutral-*`, `--palette-accent*` | **terna RGB nuda** (`234, 234, 234`) | `rgba(var(--palette-neutral-8, 234, 234, 234), 1)` |
| `--background-color`, `--text-primary-color`, `--text-secondary-color`, `--communication-background`, `--component-status-*`, `--palette-black-alpha-*` | **colore completo** | `var(--background-color, #fff)` |

Scrivere `var(--palette-neutral-8, #edebe9)` sembra funzionare in preview locale (dove la variabile non esiste e vince il fallback) ma su un host reale produce `border: 1px solid 234, 234, 234`: dichiarazione **invalida a computed-value time**, quindi la proprietà viene azzerata e **il bordo sparisce del tutto**. È un errore silenzioso che si manifesta solo dentro Azure DevOps.

Terne canoniche: `0` 255,255,255 · `2` 248,248,248 · `4` 244,244,244 · `6` 239,239,239 · `8` 234,234,234 · `10` 218,218,218 · `20` 200,200,200 · `30` 166,166,166 · `80` 51,51,51 · `100` 0,0,0.

**Tipografia.** Si dimensiona in `rem`, non in pixel: usare i `px` disallinea l'estensione dal resto della pagina e ignora lo zoom dell'utente. Scala: `body-m` .875 · `body-s` .75 · `body-xs` .6875 · `font-size-xs` .625 · `monospaced-m` .8125. I due stack sono `"Segoe UI", "-apple-system", BlinkMacSystemFont, Roboto, …` per il testo e `"Cascadia Mono", Menlo, Consolas, "Courier New", monospace` per il codice. Base dell'estensione: **`.75rem` (12px), dichiarata su `body`**.

⚠️ **La dimensione base non va mai messa su `:root`.** `rem` si risolve contro l'elemento radice, quindi `font-size` su `:root` è autoreferenziale: cambia l'unità stessa e **rimpicciolisce ogni altro `rem` del foglio** in proporzione. Azure DevOps la dichiara su `body` esattamente per questo.

**Colori del chrome.** I testi usano gli alpha neri dell'host (`--text-primary-color` `rgba(0,0,0,.9)`, `--text-secondary-color` `rgba(0,0,0,.55)`), non grigi piatti. Per i bordi la libreria ha una gerarchia precisa: **neutral-8** per separatori e bordi sottili, **neutral-20** per il contorno dei controlli, **neutral-10** per barre e cornici leggere; **neutral-30 è raro** (4 occorrenze in tutto il pacchetto) e usarlo come bordo generico rende l'interfaccia visibilmente più cupa del resto di Azure DevOps.

### 8.2 Toolchain proposta

- **TypeScript** ovunque.
- **Vite** o **webpack** per il bundling (webpack ha il plugin Monaco più collaudato; Vite è più veloce da sviluppare: decidere nello spike in base a come si comporta il worker di Monaco).
- **`tfx-cli`** per package/publish: `npx tfx-cli extension create --rev-version`.
- **Vitest/Jest** per gli unit test (parser e motore step: il grosso del valore).
- **Playwright** per un E2E leggero: l'iframe rende gli E2E costosi, tenerne pochi e mirati.

---

## 9. Test, sviluppo e distribuzione al team

### 9.1 Prerequisiti e privilegi

| Cosa | Chi serve |
|---|---|
| **Publisher sul Visual Studio Marketplace** | Chiunque può crearlo, gratis, dal [portale di publishing](https://marketplace.visualstudio.com/manage/createpublisher). L'ID del publisher va nel manifest |
| **Pubblicare / aggiornare l'estensione** | Owner o Contributor del publisher. Da CLI serve un PAT con scope `vso.gallery_manage`(Marketplace → Manage) |
| **Condividere l'estensione con l'organizzazione** | Lato publisher (chi pubblica), dal portale o con `--share-with` |
| **Installare l'estensione nell'organizzazione** | ⚠️ **Serve un amministratore**: Project Collection Administrator / Owner dell'organizzazione, o chi ha il permesso *Manage extensions*. In alternativa un utente non-admin può **richiedere** l'estensione e l'admin approva |
| **Usare il tab** | ✅ **Nessun privilegio speciale**: chiunque abbia accesso alla PR vede il tab |

Punti importanti da sapere subito:

- **Azure DevOps non permette il sideload.** Non esiste "carica un .vsix in locale": per provarla *bisogna* passare dal Marketplace, sia pure come estensione **privata**.
- **Privata è il default.** Dalla documentazione: *"By default, all extensions in the Azure DevOps Marketplace are private. They are hidden from public view, and are only visible to the publisher and specific accounts shared to by the publisher."* Nessuna verifica del publisher è richiesta finché resta privata; serve solo se un giorno si volesse renderla pubblica (`"public": true`).
- Ogni pacchetto pubblicato passa un **virus scan** automatico di Microsoft prima di diventare installabile.
- Se l'org ha policy restrittive sulle estensioni di terze parti, l'installazione va concordata con chi amministra l'organizzazione.

### 9.2 Ciclo di sviluppo: `baseUri` su localhost

Il trucco documentato che evita di ripubblicare a ogni modifica:

```jsonc
{
  "baseUri": "https://localhost:3000"
}
```

Con `baseUri` valorizzato, Azure DevOps carica il contenuto dell'estensione **dal tuo server locale** invece che dalla CDN: si pubblica **una volta sola** la versione di sviluppo, poi si lavora in hot reload.

⚠️ Il server locale **deve essere in HTTPS** (certificato self-signed accettato una volta nel browser): l'host rifiuta di caricare l'iframe da una sorgente non sicura.

### 9.3 Due estensioni, un solo codice

Pratica raccomandata dalla documentazione Microsoft:

| Estensione | Manifest | Uso |
|---|---|---|
| `<publisher>.advanced-pr-dev` | `vss-extension.dev.json` con `baseUri: https://localhost:3000` | sviluppo e debug, condivisa solo con l'org di test |
| `<publisher>.advanced-pr` | `vss-extension.json` (contenuto impacchettato) | versione reale per il team |

Stesso codice sorgente, due manifest. `tfx-cli` accetta `--manifest-globs` / `--overrides-file` per gestirlo pulito.

### 9.4 Percorso di test consigliato

1. **Organizzazione Azure DevOps personale di test** (gratuita, si crea in un minuto). Lì sei tu l'amministratore: puoi installare e disinstallare senza chiedere nulla a nessuno. **Fai tutto lo sviluppo qui.**
2. Crea un repo di prova con una PR **grande e realistica** (100+ file, path a più livelli, file binari, file grandi, più iterazioni). Serve per la performance e per il parser.
3. Servono **almeno due utenti** per validare i requisiti multi-reviewer ("vedere chi altri ha approvato"): un secondo account, anche gratuito, invitato nell'org di test.
4. Solo quando è stabile: pubblica la versione `advanced-pr`, condividila con l'org aziendale e **fai installare a un admin**. Prepara una nota che spieghi gli scope richiesti (§3.2), l'assenza di backend e credenziali persistite, e le dipendenze client incluse.
5. Rollout a un gruppo ristretto prima del team intero. Gli aggiornamenti successivi si propagano **automaticamente** alle org che hanno l'estensione installata.

### 9.5 Cosa testare, e come

| Livello | Cosa | Come |
|---|---|---|
| **Unit** (dove sta il valore) | parser e canonicalizzazione, reducer eventi, idempotenza, voto aggregato, step attivo, invalidazione selettiva | Vitest, codice puro, casi concorrenti e retry |
| **Contract** | mapping delle risposte REST → modello | payload reali registrati una volta e riusati come fixture |
| **Manuale guidato** | ancoraggio dei commenti, like, voto | checklist di round-trip: azione dall'estensione → **verifica nella UI classica di Azure DevOps** |
| **E2E** | happy path + due reviewer concorrenti + retry di una reply + sign-off esplicito | Playwright, pochi test, sull'org di test |

Il round-trip "faccio dall'estensione, controllo in AZDO" è il test più importante di tutto il progetto: è l'unico che dimostra che l'integrazione è vera e non solo apparente.

---

## 10. Roadmap

| # | Milestone | Contenuto | Esito verificabile |
|---|---|---|---|
| **M0** | **Spike di fattibilità** ⏱️ massima priorità | Manifest/scopes; contesto PR; marker HTML; Monaco/CSP/performance; ancoraggi left/right; ledger concorrente e retry; voto `-5/10`; rename/delete e paginazione (§13) | Un diff reale con commento round-trip e protocollo v2 verificato da due utenti |
| **M1** | Scheletro | Manifest, publisher, estensione `-dev` pubblicata e installata sull'org di test, `baseUri` + hot reload, SDK init, tema, CI di build | "Advanced PR" appare come tab nella PR e dice ciao |
| **M2** | PR overview | Dettaglio PR, reviewer con voti, checks (statuses + policy + build), work item, link alla PR classica | Il pannello overview è completo e corretto |
| **M3** | Motore degli step | Parser, modello canonico, marker v2, `StepPlan`, reducer puro, stepper e warning | Hash stabile su edit cosmetici; nuova versione su cambi strutturali; piani non autorizzati ignorati |
| **M4** | Diff viewer | Monaco diff, cache dei blob, virtualizzazione, soglie su binari e file grandi | PR da 100+ file navigabile in modo fluido |
| **M5** | Commenti (lettura) | Thread codice, lettura ledger, pannello laterale sincronizzato, glyph e filtri | Commenti e stato reviewer ricostruiti correttamente |
| **M6** | Commenti (scrittura) | Thread su selezione, reply idempotenti, like, resolve/riapri, recupero da timeout | Round-trip e deduplicazione verificati nella UI AZDO |
| **M7** | Approvazioni | Approve/reset step, Request changes, riconciliazione voto, sign-off esplicito (`canApprovePullRequest` + dialog + `vote 10`), invalidazione selettiva. **Manca ancora `Reject entire PR`** (§5.6) | Due utenti concorrenti vedono lo stesso stato e il voto globale resta coerente |
| **M8** | Rifinitura e rilascio | Performance, stati di errore, accessibilità, scorciatoie da tastiera, icona e overview del Marketplace, pubblicazione e installazione sull'org aziendale | Il team usa l'estensione su una PR vera |
| **M9.1** | Thread nella treeview | Thread figli del file, badge open/resolved, selezione condivisa e navigazione alla riga | Click su un commento apre il file corretto e centra l'anchor |
| **M9.2** | Decorazioni Monaco | Glyph e highlight per tutti i thread del file; stato selezionato sincronizzato con la tree | Commenti individuabili dal codice e dalla tree senza pannello laterale |
| **M9.3** | Thread inline read-only | View zone React sotto la riga selezionata, left/right aware, dispose e resize affidabili | Cronologia del thread visibile dentro il diff come nella Files review |
| **M9.4** | Interazioni inline | Refresh granulare dei thread; host multi-zona con riconciliazione, portal e `ResizeObserver`; reply, like, resolve/reopen e nuovo commento inline; rimozione del pannello destro | Flusso commenti completo senza uscire dal visualizzatore |
| **M+** | Post-v1 | Notifiche, generazione assistita del piano, ottimizzazione bundle Monaco | Esperienza pienamente AZDO-like e pronta al rollout |

**Stato 2026-08-13:** M9.1–M9.4 sono implementati; il pannello laterale non esiste più. `core/inlineZones.ts` è coperto da unit test, build e lint sono puliti. **La validazione nell'iframe reale è ancora da fare** ed è il gate prima di considerare M9.4 chiusa:

1. Click su un thread nella tree → file, lato e riga corretti; la zona è visibile senza scroll manuale.
2. File con più thread: tutte le zone montate, altezze corrette, nessuna sovrapposizione con le righe del diff.
3. Reply dentro la zona → il testo non viene perso, l'altezza si ricalcola, l'editor non viene ricostruito e lo scroll non salta.
4. Digitazione nella reply: frecce, `Ctrl+F` e `Esc` non pilotano Monaco.
5. `+` nel glyph margin su riga libera → composer ancorato alla riga giusta; con una selezione attiva → range multi-riga; il thread creato è verificato nella UI classica di AZDO (lato e offset corretti: l'offset di fine per il click su riga è la lunghezza della riga + 1, da confermare nel round-trip).
6. Cambio file e cambio step: nessuna zona residua, nessuna crescita di memoria dopo dieci cambi.
7. Commento a livello file / reso orfano da un push → compare nella zona sopra la prima riga.
8. Toggle inline ↔ side-by-side: le zone si rimontano correttamente e un thread sul lato base passa dalla zona in cima (inline) alla riga giusta dell'editor originale (side-by-side).

La preferenza di layout è per sessione: la persistenza per-utente in `ExtensionDataService` (§3.4) resta da fare insieme alle altre preferenze UI.

---

## 11. Rischi e mitigazioni

| # | Rischio | Impatto | Mitigazione |
|---|---|---|---|
| **R1** | **Monaco / web worker non funzionanti nell'iframe dell'estensione** | **Alto** | Verifica in M0 come primissima cosa. Piano B pronto: `jsdiff` + renderer leggero (§7.2) |
| **R2** | **Mapping riga/offset dei commenti fra Monaco e AZDO** (left/right, 1-based, iterazioni) | **Alto** | Round-trip reale in M0 su entrambi i lati del diff e su una PR con più iterazioni |
| R3 | `tabContext` delle `pr-tabs` non contiene `pullRequestId`/`repositoryId` | Medio | Usare soltanto API SDK/configurazione documentata; nessun parsing della route. Verifica in M0 |
| R4 | Gli HTML comment vengono sanitizzati nei commenti PR | Basso | Fallback su marker visibile in code-span. Verifica in M0 |
| R5 | Il voto è **unico per reviewer sull'intera PR**, non per step | Medio | Comandi espliciti, aggregazione di tutti gli step e nessuna sovrascrittura di voti esterni (§5.3, §5.6) |
| R6 | Performance con 100+ file, tutto client-side | Medio | Un solo editor riusato, virtualizzazione, cache per `objectId`, soglie sui file grandi, caricamento **per step** |
| R7 | L'admin dell'org non autorizza l'installazione (scope `vso.code_write`) | Medio | Nota su architettura e dipendenze; verifica endpoint-per-endpoint e scope minimi in M0 |
| R8 | Il piano/ledger viene modificato o cancellato durante la review | Medio | Hash canonico, versioni e modalità sola lettura; mai degradare silenziosamente a un piano approvabile |
| R9 | Il piano non è aggiornato rispetto ai file della PR | Basso | Warning "stale entry" espliciti, lo step catch-all assorbe tutto |
| R10 | Rate limit / throttling di Azure DevOps | Basso | Caching aggressivo dei blob (immutabili), niente polling stretto, rispetto di `Retry-After` |
| R11 | Marketplace: ogni aggiornamento passa da publish + virus scan | Basso | `baseUri` su localhost per lo sviluppo; publish solo per i rilasci |
| R12 | Piano spoofed da un utente non autorizzato | Medio | Accettare solo PR author/bot configurati e mostrare warning sugli altri marker |
| R13 | Retry o doppio click duplicano un evento | Medio | `eventId`, rilettura dopo timeout e reducer idempotente |
| R14 | Due reviewer scrivono contemporaneamente | Medio | Un solo thread-ledger, reply append-only e ordinamento deterministico |
| R15 | Hash instabile invalida approvazioni legittime | Medio | Canonicalizzazione testata; edit cosmetici non cambiano `planHash` |
| R16 | Paginazione, rename o delete sfuggono all'invalidazione | Medio | Contract test con payload reali e raccolta di tutte le pagine dei cambi |

---

## 12. Domande aperte

> Le decisioni su navigazione libera, file "viewed", step vuoti e thread aperti sono chiuse in §0 e §5. Restano aperte soltanto le scelte di prodotto o ambiente seguenti.

### Sul comportamento funzionale

- **Q5, Il thread-ledger nella discussione.** Il tab deve nasconderlo dalla lista dei normali commenti o mostrarlo come registro separato e consultabile?
- **Q6, Glob nel piano.** Vuoi supportare voci tipo `src/Core/**` o `src/Core/` oltre ai path esatti? Su PR da 100+ file fa una differenza pratica notevole per chi scrive il commento.
- **Q7, Chi può fare cosa.** Un utente che **non** è reviewer della PR può aprire il tab in lettura? E può commentare o approvare step?

### Su processo e ambiente

- **Q11, Org di test.** Hai già un'organizzazione Azure DevOps personale utilizzabile per lo sviluppo, o va creata? E hai un secondo account per i test multi-reviewer?
- **Q12, Chi amministra l'org aziendale.** Sai già chi può installare estensioni sull'organizzazione del team? Conviene coinvolgerlo **presto**, non a lavoro finito.
- **Q13, Azure DevOps Server on-prem.** Va supportato anche l'on-prem, o solo `dev.azure.com` cloud? (Il contribution point esiste anche lì, ma il Marketplace e alcune API cambiano.)
- **Q14, Scope `vso.work`.** Serve davvero mostrare i work item collegati? Toglierlo riduce gli scope richiesti e semplifica l'approvazione dell'admin.
- **Q16, L'estensione deve saper *scrivere* il piano?** Deciso che il marker è obbligatorio (§0), resta da capire quanto aiutare chi lo scrive: (a) niente, l'autore scrive il commento a mano; (b) un pulsante **"Copy template"** che copia negli appunti lo scheletro con i file della PR già elencati; (c) un pulsante **"Create review plan"** che crea direttamente il thread nella PR, con eventuale editor degli step dentro il tab. La (b) costa poco ed elimina quasi del tutto il rischio "marker dimenticato"; la (c) è la più comoda ma allarga lo scope della v1.

---

## 13. Prossimo passo concreto

**Lo spike M0, in quest'ordine**, chiude i dubbi che possono ancora cambiare il design:

1. Validare il manifest con `tfx extension create`, pubblicare l'estensione `-dev` e verificare consenso e scope minimo endpoint per endpoint.
2. Ottenere `pullRequestId` e `repositoryId` tramite il contratto supportato di `SDK.register` / `updateContext`, senza dipendere dal parsing della route.
3. Caricare due blob reali in Monaco: worker senza violazioni CSP, soglie di apertura/cambio file/memoria rispettate; provare il fallback se una soglia fallisce.
4. Creare commenti ancorati su lato left e right, poi verificarli nella UI classica dopo una nuova iterazione.
5. Verificare che marker HTML v2 e metadati sopravvivano a create/read/edit; provare un piano autorizzato e uno creato da un utente non autorizzato.
6. Far rispondere due reviewer contemporaneamente allo stesso ledger; simulare timeout e retry con lo stesso `eventId`; verificare uno stato unico e senza duplicati.
7. Provare edit cosmetico e strutturale del piano: il primo conserva hash e approvazioni, il secondo crea una nuova versione logica.
8. Provare rename, delete, file nuovo e oltre 2000 cambi, verificando invalidazione selettiva e paginazione completa.
9. Impostare `vote -5` con due step in `ChangesRequested`, approvarne uno e verificare che il voto resti `-5`; completare gli step e usare il sign-off esplicito per `vote 10`.

La stima va aggiornata dopo aver predisposto org, utenti e PR fixture: il protocollo concorrente amplia M0 rispetto allo spike originale, ma evita di scoprire problemi di consistenza in M7.

---

## Fonti

- [Extensibility Points, Azure DevOps](https://learn.microsoft.com/en-us/azure/devops/extend/reference/targets/overview?view=azure-devops) (contribution point `ms.vss-code-web.pr-tabs`)
- [Extension manifest reference](https://learn.microsoft.com/en-us/azure/devops/extend/develop/manifest?view=azure-devops) (scope, `baseUri`, flag public/private)
- [Authenticate and secure web extensions](https://learn.microsoft.com/en-us/azure/devops/extend/develop/auth?view=azure-devops) (chiamate per conto dell'utente corrente)
- [Package and publish extensions](https://learn.microsoft.com/en-us/azure/devops/extend/publish/overview?view=azure-devops) (publisher, privata/pubblica, condivisione, installazione, debug con `baseUri`)
- [Add tabs on query result pages](https://learn.microsoft.com/en-us/azure/devops/extend/develop/add-query-result-tabs?view=azure-devops) (contratto delle tab contribution)
- [Pull Request Comment Likes, REST API 7.1](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-comment-likes?view=azure-devops-rest-7.1)
- [microsoft/azure-devops-extension-sdk](https://github.com/microsoft/azure-devops-extension-sdk) · [microsoft/azure-devops-extension-api](https://github.com/microsoft/azure-devops-extension-api) · [microsoft/azure-devops-extension-sample](https://github.com/microsoft/azure-devops-extension-sample)
