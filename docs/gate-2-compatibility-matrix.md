# Gate 2: matrice di implementazione e compatibilità

Questa matrice distingue il percorso manuale approvato dal movimento nativo
originario. «Testato» indica solo la prova descritta; non indica abilitazione in
produzione. Le valutazioni riguardano il codice e le prove disponibili il
2026-11-08, non tutte le versioni future dei runtime. Il Gate 2 è chiuso nel
perimetro manuale approvato; le garanzie native originarie indicate sotto
restano non dimostrate o incomplete e non sono abilitate da questa chiusura.

| Requisito | Codice Turnlink | OpenCode | Codex | Stato e lavoro residuo |
| --- | --- | --- | --- | --- |
| Identità del chiamante | `src/mcp.js`, `adapters/opencode-runtime.js`, `src/tools.js` | Il plugin associa la chiamata alla sessione OpenCode. | L'MCP stdio associa la chiamata ai metadati del thread Codex. | Implementato. La migrazione completa deve conservare tale identità senza adottare una nuova conversazione. |
| Anteprima e approvazione manuale | `src/tools.js`, `src/control/contracts.js`, `src/control/gateway.js` | Supportato con controllo e task abilitati. | Supportato con MCP control e proxy task abilitati. | Implementato; l'anteprima vincola task e percorsi, non certifica la configurazione. |
| Record e confronto | `src/tools.js`, `src/session-evidence.js` | `channel_session_context` osserva runtime, modello e fingerprint di regole native in ambito limitato. | Il proxy può esporre la versione nativa tramite health; gli altri dati restano osservazioni dell'agente. | Implementato come resoconto, con rifiuto dei valori sconosciuti e blocco in caso di differenze. Non dimostra indipendentemente policy OS, servizi remoti o tutta l'autorità della destinazione. |
| Arresto e azioni esterne | `src/broker.js`, `src/control-admin.js` | Disconnessione del receiver osservata. | Disconnessione del receiver osservata. | Il broker registra l'attestazione dell'operatore; l'operatore controlla gli effetti esterni. Nessuna esclusione automatica di tutti i writer o verifica della chiusura dei lavori remoti è dimostrata. |
| Trasferimento host e receiver manuale | `src/broker.js`, `src/client.js`, `src/control-admin.js` | Prova fisica con sessione e modello reali, inclusi task e accettazione. | Prova fisica con modello reale, broker e proxy; il modello sceglie claim/report tra due operazioni descritte dalla fixture. | Il record Codex contiene impostazioni sintetiche fornite dal test; un tentativo precedente ha atteso inutilmente il confronto dopo il rejoin. La ricevuta manuale non è una ricevuta di handoff nativo. |
| Task e prova dell'esito | `adapters/opencode-tasks.js`, `src/codex-tasks.js`, `src/control/gateway.js` | Adapter opt-in con journal ed evidenza; flusso fisico con agente reale. | Proxy opt-in con journal ed evidenza; prove fisiche con modello reale e simulato, con claim/report MCP. | Nella prova Codex reale la fixture descrive due operazioni e fornisce ID e campi; il modello sceglie e compone le chiamate. I flag di movimento nativo restano distinti. |
| Recupero manuale | `src/broker.js`, `src/tools.js`, `src/control-admin.js`, `test/manual-resume-recovery.test.js` | Osservazioni e trasferimento host verificati. | Usa lo stesso broker; test del proxy coprono ripresa e riconnessione. | Riavvio, record mancanti, subentro e riconciliazione sono coperti dalle prove elencate sotto; non ogni combinazione di interruzione è stata esercitata fisicamente su entrambi i runtime. |
| Handoff nativo e pubblicazione | codice storico nel branch sperimentale e `docs/receiver-handoff.md` | Esiste una prova integrata di destinazione/receiver in processi isolati, default-off; l'orchestrazione ordinaria non è completa. | Componenti sperimentali presenti; l'integrazione completa della destinazione, delle risorse e del receiver non è dimostrata. Il native-control sperimentale rifiuta Windows. | Incompleto rispetto al gate originario. Il broker pubblicizza `worktreeExecutionEnabled: false`; il percorso manuale non abilita questa capacità. |
| Autorità ed esclusione native | `src/worktree-snapshot.js`, `src/codex-admission-fence.js`, documentazione dei prototipi nativi | Esistono osservazioni e prove isolate, non una prova generale di tutti gli ingressi e delle policy esterne. | Esistono osservazioni e prototipi; il controllo completo dei writer concorrenti e dell'autorità destinazione non è esposto dal percorso standard dimostrato. | Da stabilire tramite verifica delle interfacce ufficiali e dei confini OS; non assumere che un proxy o un lock cooperativo basti, e non modificare i runtime senza istruzioni. |

## Prove e comandi di riferimento

L'inventario locale del 2026-11-07 ha rilevato Codex CLI 0.165.0 e OpenCode
2.2.6. La prova fisica precedente usava 2.2.5; il percorso manuale completo è
stato poi verificato nuovamente con 2.2.6 su Mac e Reborn l'8 novembre,
inclusi modello reale, receiver, task e accettazione. Il fingerprint osserva
le regole native documentate, non le policy OS o remote. Lo schema app-server
generato dal Codex installato, includendo i metodi sperimentali, elenca fra gli
altri `thread/resume`, `thread/read`, `thread/turns/list`, `turn/start`,
`turn/interrupt` e `config/read`; non presenta un metodo denominato per la
prenotazione o il trasferimento della continuità. Questo inventario descrive
l'interfaccia ispezionata, non prova che una garanzia sia impossibile mediante
altre interfacce o isolamento del sistema operativo.
La [documentazione ufficiale OpenAI](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
descrive la ripresa di un thread dopo il riavvio tramite `thread/resume`;
non presenta questa operazione come una prova di esclusione degli altri writer
o di equivalenza di tutte le policy della destinazione.

## Fattibilità delle garanzie native con i runtime invariati

Decisione finale dell'operatore: il task per garanzie automatiche universali è
chiuso con limitazioni dichiarate. Non è stato trovato un metodo dimostrato per
tutti gli ambienti e servizi con i runtime originali; l'automazione nativa non
è attivata e i risultati seguenti non equivalgono a una prova di impossibilità.
Una ripetizione mirata su Codex 0.165.0 ha confermato l'uso di istruzioni
precedenti dopo modifica del file e il rifiuto di un secondo writer compatibile
nel solo scenario locale provato; il primo processo sintetico è stato terminato
per osservare il rilascio. Entrambi i test sono passati.

Inventario rieseguito l'8 novembre con Codex CLI 0.165.0 e OpenCode 2.2.6.
Lo schema `ClientRequest.json` generato da Codex con `--experimental` contiene
176 nomi di metodo distinti; comprende anche la lista e la terminazione dei
terminali di background del thread. Non contiene nomi con `handoff`,
`continuity`, `quiesce`, `reserve` o `fence`. È una ricerca sui nomi e sulle
interfacce generate, non una dimostrazione che nessuna combinazione di API o
meccanismi del sistema operativo possa fornire la garanzia.

| Garanzia originaria | Capacità verificata | Lacuna concreta e prova ancora necessaria |
| --- | --- | --- |
| Esclusione di nuovi turni e writer sorgente | `CodexAdmissionFence` trattiene le richieste che attraversano il suo singolo processo stdio; `turn/interrupt` resta disponibile. Nella prova locale con due processi Codex 0.165.0 e lo stesso storage sintetico, il runtime ha rifiutato il secondo writer del thread attivo. | Il fence non controlla altri processi. La prova nativa è limitata a quel runtime, host e storage: non copre altri host, writer esterni o risorse remote. Occorre collegare e verificare il confine effettivo del percorso di produzione; l'attestazione umana approvata copre il percorso manuale. |
| Termine del lavoro attivo e delle azioni esterne | Codex espone `turn/interrupt` e metodi per i terminali di background del thread; il broker rileva la disconnessione del receiver. | L'interruzione e la disconnessione non dimostrano che processi esterni, servizi remoti o effetti già avviati siano conclusi. Per il percorso manuale l'operatore li controlla sul resoconto dell'agente. |
| Autorità effettiva della destinazione | Codex espone `config/read`; OpenCode restituisce il fingerprint delle regole dell'agente e della sessione, con due osservazioni consecutive. | Le osservazioni correnti non dimostrano tutte le istruzioni, policy OS/remote, strumenti e credenziali applicabili né la loro invariabilità fino all'avvio. Servono sorgenti complete e una verifica valida al momento dell'ammissione, con prove di cambiamento tra lettura e uso. |
| Receiver e pubblicazione della destinazione | Il broker può mantenere il receiver in attesa; OpenCode dispone di una prova nativa isolata e disattivata per default. | L'orchestrazione ordinaria non è completa. Il broker non dispone ancora di un verifier di completamento nativo Codex; l'opzione sperimentale Codex rifiuta Windows. Occorre una prova integrata di pubblicazione, ownership, rilascio e recupero senza equiparare la ricevuta manuale al movimento nativo. |

Riferimenti verificabili: `src/codex-admission-fence.js`,
`adapters/opencode-session-context.js`, `src/broker.js`,
`src/codex-proxy.js` e [receiver handoff](receiver-handoff.md). Queste lacune
non autorizzano modifiche ai runtime: eventuali estensioni, isolamento esterno
o modifiche esplicite del perimetro vanno valutati separatamente.

Le prove esistenti delimitano il risultato: `test/codex-admission-fence.test.js`
verifica sia l'accodamento nel singolo proxy sia il rifiuto di attività ignota;
`test/opencode-session-context.test.js` verifica fingerprint e rifiuto di
impostazioni cambiate durante l'osservazione. Le prove sperimentali del receiver
di destinazione sono state archiviate con il trasferimento automatico e non
costituiscono garanzie native di produzione.

Il test opt-in `test/codex-native-continuity.test.js` è stato eseguito l'8
novembre sul Codex ufficiale 0.165.0 installato, con due processi locali,
storage sintetico condiviso e inferenza simulata su loopback: **6 test passati**.
La ripresa dopo l'arresto conserva lo stesso thread e la cronologia, applica la
directory di destinazione e ricarica le istruzioni sintetiche; `config/read`
da solo non espone il contenuto del file `AGENTS.md` della destinazione. Il
secondo processo è stato rifiutato come writer mentre il primo deteneva il
thread; nella prova l'accesso è riuscito dopo la terminazione del primo
processo. Queste osservazioni non certificano l'autorità completa della
destinazione, l'esclusione su macchine o storage differenti, né il rilascio di
processi o servizi esterni.

La quarta prova caratterizza un limite concreto di freschezza: in Codex
0.165.0, modificando il file `AGENTS.md` sintetico della destinazione dopo
`thread/resume` e prima del turno successivo, quel turno ha ricevuto ancora il
contenuto precedente. Dopo arresto e riavvio del processo, la stessa sessione
ha ricevuto il contenuto aggiornato. Il test riguarda questo file, questa
versione e lo scenario locale: non dimostra una verifica atomica né copre tutte
le sorgenti di istruzioni e policy. Il confronto è stato rafforzato mantenendo
identici il contenuto del file sul disco, l'oggetto `config` restituito da
`config/read`, i percorsi `instructionSources` restituiti da `thread/resume`
e l'ID del thread nei due momenti: prima del riavvio il turno ha
ricevuto la vecchia istruzione, dopo il riavvio quella nuova. Queste osservazioni
specifiche non bastano quindi a dimostrare quale contenuto sia stato caricato;
non escludono che altre interfacce o un isolamento aggiuntivo possano farlo.

I tipi dell'app-server generati dal Codex installato prevedono anche uno stato
MCP con catalogo strumenti, stato di connessione e autenticazione. Il tipo
consente tuttavia cataloghi in cache: la sola presenza di queste informazioni
non prova la freschezza del catalogo o le policy effettive del server remoto.

Altre prove con Codex 0.165.0 hanno cambiato tramite `turn/start` nello stesso
thread la policy di approvazione da `on-request` a `never` e il modello da
`fixture` a `fixture-other`, senza eseguire strumenti. Il proxy Turnlink
invalida la selezione osservata quando simili richieste passano da lui:
`test/codex-task-proxy.test.js` verifica entrambi i casi e che il task resti
fermo fino a una nuova osservazione del thread, quindi possa riprendere.
Questa difesa riguarda il percorso attraverso quel proxy, non tutte le possibili
modifiche esterne o una prova completa delle policy remote.

Il test opt-in `test/opencode-service.test.js` è passato con OpenCode ufficiale
2.2.6, modello simulato, broker e progetto Git locali, abilitando anche
`TURNLINK_TEST_STOP_MOVE_REJOIN=1`. Dopo l'arresto del servizio ha riaperto la
stessa sessione, verificato gli snapshot, spostato la sessione nella worktree e
osservato invariati ID, agente, modello e regole di sessione riportati dal
runtime. Un messaggio indirizzato al receiver disconnesso è rimasto in attesa
fino al rejoin. Lo snapshot ha lasciato l'esecuzione non idonea perché la
configurazione conteneva plugin dinamici non risolti. Sono osservazioni locali:
il test usa un indicatore sintetico di inattività e non dimostra esclusione
dei writer, autorità completa o handoff nativo di produzione.

- `test/session-preparation.test.js`: record, confronto e osservazioni del
  coordinatore; `test/manual-resume-selection.test.js`: scelta locale univoca.
- `test/control-broker.test.js`: ricevuta manuale, autorizzazione host e casi
  di recupero; `test/manual-resume-recovery.test.js`: stati al riavvio broker.
- `test/codex-task-proxy.test.js`: task manuale e riconnessione con fixture;
  `test/codex-native-agent-manual.test.js`: Codex ufficiale con modello
  deterministico, opt-in e profilo isolato, anche Mac–Reborn con
  `TURNLINK_LOCAL_CODEX_AGENT=1 TURNLINK_CODEX_PHYSICAL_REBORN=1` e senza
  `TURNLINK_LOCAL_CODEX_LIVE`.
- `test/opencode-physical-manual.test.js`: prova OpenCode fisica e modello
  reale, opt-in; la fixture individua il proprio host e non va rieseguita senza
  verificare destinazione, isolamento e autorizzazione del payload.
- `npm test` include i file di test, ma gli opt-in non attivi vengono saltati.
  `npm run test:worktrees` abilita test di integrazione e richiede runtime e
  ambiente predisposti; non va considerato prova di tutte le garanzie native.

I resoconti delle prove fisiche e dei limiti delle impostazioni sintetiche sono
nel [checkpoint](control-plane-roadmap.md#current-gate-2-checkpoint--2026-11-07)
e nel [registro](remaining-development.md#gate-2-closure-checklist).

## Recupero manuale: copertura verificata

| Interruzione o condizione | Evidenza | Limite |
| --- | --- | --- |
| Riavvio broker con osservazione armata, disconnessa o confermata | `test/manual-resume-recovery.test.js` | Test del broker con dati sintetici, non di tutti i runtime fisici. |
| Record mancante, cambiato, cronologia invalida o aggiornamenti concorrenti | `test/session-preparation.test.js`, `test/session-record-storage.test.js`, `test/control-broker.test.js` | La copia privata non è prova indipendente di consegna. |
| Trasferimento host scaduto, annullato, cambio coordinatore e record originale | `test/manual-resume-recovery.test.js`, `test/control-broker.test.js` | Le varianti sono verificate su broker sintetico. |
| Receiver assente, confronto non corrispondente o attestazione mancante | `test/control-broker.test.js` | Il blocco non dimostra l'esclusione automatica di writer esterni. |
| Ripresa proxy e ammissione del task | `test/codex-task-proxy.test.js` e prove fisiche manuali | Nella prova Codex reale il modello sceglie tra due operazioni descritte dalla fixture; un tentativo precedente si è fermato prima del confronto e non sono provati tutti i punti di crash end-to-end. |
