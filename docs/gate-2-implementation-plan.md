# Gate 2: piano di completamento

**Stato 2026-11-08: chiuso nel perimetro manuale approvato dall'operatore.**
La chiusura comprende i controlli e i recuperi manuali documentati sotto;
non attesta handoff nativo automatico, esclusione indipendente dei writer,
completamento delle attività esterne o autorità completa della destinazione.
Le prove su runtime reali usano in parte dati o modelli sintetici; i dettagli
e i casi saltati restano espliciti nel registro. La chiusura non abilita
funzioni native sperimentali né costituisce una pubblicazione.

**Task garanzie native automatiche universali: chiuso per decisione di
perimetro dell'operatore.** L'analisi finale non ha individuato un metodo
dimostrato che copra tutti gli scenari con i runtime originali. Il risultato è
una limitazione dichiarata, non una garanzia implementata: il movimento nativo
automatico rimane disabilitato. Un'eventuale soluzione futura per un ambiente
isolato e servizi definiti è lavoro separato; non è stata dimostrata
l'impossibilità assoluta di altre soluzioni.

Stato verificato il 2026-11-07. Il piano riguarda Gate 2, non tutti i gate del
control plane. Mantiene la scelta dell'operatore: runtime originali, arresto e
ripresa manuali consentiti, conferma umana dell'arresto e verifica umana dei
lavori esterni sulla base del resoconto dell'agente. Non modificare o
ricompilare i runtime senza una nuova istruzione esplicita.

## Cosa esiste già

- Anteprima e approvazione manuale, richiesta del record all'agente, confronto,
  conferma dell'operatore, trasferimento della registrazione tra host, blocco
  dei task e recupero di alcuni stati incerti sono già implementati in Turnlink.
- I percorsi manuali OpenCode e Codex sono stati verificati tra Mac e Reborn
  con modello reale, broker/adapter, task e accettazione. Nella prova Codex più
  recente il modello ha scelto claim e report tra due operazioni descritte
  dalla fixture, che forniva stato sintetico, ID e campi necessari; il modello
  ha composto le chiamate MCP. Alcune impostazioni del record erano dati
  sintetici. Non dimostra equivalenza completa delle impostazioni reali della
  destinazione né decisioni senza le istruzioni fornite.
- Il percorso nativo OpenCode di destinazione e receiver ha una prova integrata
  isolata, disattivata per impostazione predefinita. Non equivale alla chiusura
  del gate tra runtime. Il percorso nativo Codex e l'orchestrazione ordinaria
  non hanno ancora la stessa copertura.

Fonti e limiti: [checkpoint corrente](control-plane-roadmap.md#current-gate-2-checkpoint--2026-11-07),
[registro](remaining-development.md#gate-2-closure-checklist),
[receiver OpenCode](receiver-handoff.md#current-opencode-destination-result--2026-10-30).

## Ordine di lavoro

### 1. Inventario eseguibile e confine di compatibilità

- Mappare per Codex e OpenCode il percorso effettivo: launcher, broker, adapter,
  record, autorizzazione host, receiver, conferma, task e recupero. Per ogni
  componente indicare file, stato, flag, test esistenti e lacuna verificabile.
- Separare un difetto del codice Turnlink da una capacità assente o non
  dimostrata del runtime. Verificare nelle interfacce effettivamente disponibili
  se il runtime originale permette di osservare e imporre ciascuna garanzia
  nativa richiesta. Non dedurre che serva una modifica, né che basti un wrapper,
  senza una prova.
- Conservare il working tree esistente e classificare le modifiche già presenti;
  non resettare o eliminare file dell'utente.

**Completato quando:** esiste una matrice con implementato / incompleto /
non verificato / non disponibile, per runtime e piattaforma, con riferimenti al
codice. Le eventuali incompatibilità con i runtime originali restano esplicite.

La [matrice corrente](gate-2-compatibility-matrix.md) collega componenti,
piattaforme e prove disponibili. L'inventario delle interfacce pubbliche e dei
confini effettivamente controllati è registrato nella sezione sulla fattibilità:
esso distingue ciò che è stato osservato dalle garanzie ancora non dimostrate,
senza dedurre l'impossibilità da un'assenza di nomi nello schema.
Il test di integrazione Codex con modello simulato può ora usare il runtime
ufficiale già installato sul Mac in un profilo isolato, senza scaricarne o
compilarne un altro; non sostituisce la prova fisica con modello reale.

### 2. Chiudere le lacune Turnlink del percorso manuale

- Verificare e completare, dove mancano, il passaggio record sorgente →
  osservazione della disconnessione → autorizzazione dell'host → rejoin alla
  destinazione → confronto → attestazione → rilascio del task. Riutilizzare i
  comandi e le ricevute esistenti; non sostituirli con una seconda procedura.
- Assicurare che l'agente riceva richieste chiare di raccogliere le informazioni
  accessibili, riportare `unknown` quando non le conosce, conservare il lavoro e
  segnalare effetti esterni o attività in background. Il record condiviso deve
  restare sanitizzato e recuperabile dalla cronologia secondo la retention
  effettiva; non attribuire al resoconto un valore di verifica indipendente.
- Chiudere i difetti che emergono su identità della sessione, percorsi Windows,
  prova del receiver, record incompleti o cambiati, messaggi non confermati e
  ripartenza del coordinatore. Conservare i comportamenti che trattengono il
  task quando manca una prova necessaria.
- Rendere la procedura operativa utilizzabile senza trascrivere identificativi:
  usare i dati già disponibili a broker/agente e mostrare all'operatore solo le
  decisioni e le azioni manuali effettivamente necessarie. Non simulare la copia
  della conversazione: deve usare un metodo di ripresa supportato e documentato.

**Completato quando:** i due adapter possono completare il percorso previsto e
ogni stato di blocco indica il passo concreto per proseguire o recuperare. Le
ulteriori modifiche sono guidate dall'inventario, non presunte in anticipo.

Avanzamento: l'adapter OpenCode conserva ora una notifica di task ricevuta
durante una richiesta precedente che risponde senza task. La riproduzione
mirata falliva prima della correzione e passa dopo; non sostituisce la prova
end-to-end.
Quando l'agente invia il record del task e dell'anteprima approvati, Turnlink
ne salva una copia privata esatta sulla sorgente prima di inoltrarlo. I dati
restano quelli forniti dall'agente; la destinazione usa la cronologia condivisa.
Il salvataggio è stato verificato nelle prove fisiche OpenCode e Codex.
È disponibile anche una selezione privata del singolo trasferimento manuale:
il file associa task e anteprima ai comandi di riesame, autorizzazione host e
conferma senza trascrivere UUID. Se esistono più candidati, la selezione si
ferma e può essere ristretta al nome esatto del membro; le verifiche del
broker restano obbligatorie.
Il riesame amministrativo mostra ora anche il record sorgente esatto associato
all'osservazione, che l'agente è istruito a sanitizzare, incluso il riepilogo di lavoro ed effetti
da controllare. Un record successivo differente non sostituisce il riferimento;
se il record originale non è disponibile, il riesame lo indica con `null`.
Il comando di riesame aggiunge un'indicazione del prossimo passo, separata dalle
autorizzazioni: attesa, ripristino del record, ripartenza dalla sorgente,
risoluzione del confronto o conferma dell'operatore secondo lo stato osservato.
Il file di selezione supporta anche il subentro del coordinatore attivo e
l'annullamento del subentro pendente, senza trascrivere UUID. Un nuovo subentro
richiede un coordinatore attivo; un intento già registrato può essere invece
riconciliato dopo il riavvio anche se il coordinatore è offline. I controlli
dei record e del broker restano invariati.

Se la risposta all'invio automatico del confronto va persa, un evento di
presenza concorrente non causa più un secondo invio nella stessa istanza del
coordinatore. La watch consulta la cronologia per riconoscere la richiesta
esatta già registrata; se non la trova, conserva lo stato incerto e segnala
come procedere. Dopo il riavvio il broker deduplica l'eventuale richiesta con
lo stesso identificativo e contenuto finché il messaggio è conservato. Una
prova con broker reale copre invio registrato, risposta persa, evento
concorrente, recupero dalla cronologia e assenza di una seconda richiesta;
non prova che un invio assente dalla cronologia non sia ancora in corso.
La suite standard dopo la correzione ha registrato 1.398 test passati, zero
errori e 427 saltati; i test saltati non fanno parte della verifica. Sono
passati anche 30 test mirati di preparazione e recupero, più i casi mirati
del broker con riavvio, trasferimento e cambio coordinatore.

### 3. Recupero e interruzioni

- Completare e collegare i casi non coperti di arresto durante preparazione,
  trasferimento host, rejoin, confronto, conferma e ammissione del task.
- Verificare riavvio broker/coordinatore/proxy, messaggi duplicati o persi,
  prova di destinazione assente, record non più disponibile, cambio di
  coordinatore e trasferimento annullato. Non ripetere automaticamente un effetto
  quando non se ne conosce l'esito; mantenere lo stato incerto e recuperabile.
- Conservare il confine già accettato: la conferma umana non dimostra che altri
  writer o effetti esterni siano terminati automaticamente.

**Completato quando:** per ogni interruzione la sessione riprende senza un
secondo effetto oppure rimane bloccata con una procedura di recupero verificata.

Copertura verificabile del percorso manuale (broker reale con sessioni
sintetiche, salvo diversa indicazione):

| Interruzione | Esito verificato | Prova |
| --- | --- | --- |
| Riavvio con ricevitore sorgente armato | Stato incerto; la destinazione non riceve il task. Il ripristino richiede il ricevitore sorgente e un record aggiornato. | `manual resume rearms only from the original receiver after a broker restart` |
| Risposta persa al record o alla richiesta di confronto | Il record viene riconciliato con lo stesso ID; per il confronto la watch cerca il messaggio registrato e non ripete l'invio nella stessa istanza. Se assente, rimane incerto. | `manual resume requires agent comparison, destination receiver and an operator stop attestation`; `presence during a lost comparison reply...` |
| Trasferimento host pendente, annullato o con risposta persa | Il trasferimento resta registrato, può essere riesaminato o annullato dove previsto e gli ID annullati non sono riutilizzati. | `an operator can transfer a stopped manual session...`; `an expired pending host transfer...`; `a pending host transfer can be cancelled...` |
| Cambio coordinatore o riavvio dopo subentro | Il subentro usa il record originale e resta bloccato fino a un nuovo confronto; un'operazione già commessa è riconciliabile senza ripeterla. | `an operator can recover a completed host transfer with a new coordinator...` |
| Record originale mancante o confronto diverso | Il riesame segnala l'assenza; record cambiati, confronti incompleti o diversi non autorizzano il task. | `operator review marks a missing original record...`; `manual comparison never reports a match...`; prove di subentro |

Questa tabella non prova tutte le combinazioni di arresto di processo, rete e
retention su ogni piattaforma. In particolare resta non identificata la causa
del precedente tentativo fisico Codex rimasto in attesa dopo il rejoin.

Avanzamento: una risposta di cronologia non valida viene ora segnalata come
errore sia nel ripristino delle osservazioni del coordinatore sia durante
un'osservazione attiva, invece di apparire come un recupero riuscito.
Il salvataggio privato rifiuta inoltre un reinvio con lo stesso identificativo
e contenuto diverso già visibile nella cronologia corrente; un reinvio identico
di un record precedente non sovrascrive la copia più recente. La verifica non
esclude altri processi, e un esito d'invio incerto richiede sempre il recupero
dal broker e la conferma del coordinatore.
Se la risposta dell'invio più recente viene persa, il reinvio con lo stesso ID
riconosce il messaggio salvato dal broker, ripristina se necessario la copia
privata esatta e conferma il salvataggio. Una prova mirata copre anche il caso
di un record più recente oltre una pagina di cronologia. Il caso di risposta
persa è stato verificato anche con il broker reale della fixture e il seguito
del percorso manuale, senza creare un secondo messaggio.
Il broker conserva inoltre gli ID dei trasferimenti host annullati e rifiuta
di riutilizzarli: due cicli consecutivi, i vecchi annullamenti e il riavvio
sono verificati per percorsi POSIX e Windows. Il comando selezionato genera un
nuovo ID dopo un annullamento; i limiti e la compatibilità dello stato sono
documentati in [control-plane.md](control-plane.md). Quando il limite impedisce
una nuova autorizzazione, il riesame indica di riconnettere la sorgente e
resettare l'anteprima; la CLI e il blocco sono verificati al limite.

### 4. Garanzie native originarie: verifica di fattibilità e integrazione

**Conclusione dell'analisi:** completata con la decisione di perimetro sopra.
Il proxy non esclude gli accessi che non lo attraversano; osservazioni di file
e configurazione non dimostrano tutto ciò che il runtime ha caricato; un
servizio esterno indipendente non fornisce necessariamente uno stato verificabile.
Il receiver e la pubblicazione nativi ordinari restano incompleti. Le garanzie
universali non sono dichiarate disponibili né richieste per il percorso manuale.

- Mappare l'autorità effettiva della destinazione: istruzioni, modello/provider,
  strumenti e policy, loro origine e invalidazione tra verifica e avvio.
- Valutare una reale esclusione dei writer sorgente e delle risorse ancora
  attive, distinta dalla conferma manuale. Un lock cooperativo non protegge da
  un runtime già avviato che non lo rispetta.
- Integrare dove possibile il passaggio receiver, la pubblicazione a
  destinazione e la riconciliazione dopo crash; riutilizzare la prova OpenCode
  già esistente e colmare le differenze Codex senza dichiarare equivalenti una
  ricevuta manuale e una ricevuta di movimento nativo.
- Se le interfacce originali non permettono una garanzia, documentare la prova e
  fermare solo quel criterio: proporre separatamente un'estensione del runtime,
  un isolamento verificabile o l'accettazione esplicita di un limite. Non
  implementare modifiche al runtime sotto il vincolo corrente.

**Completato quando:** ogni garanzia è collegata alla funzione effettiva e alle
prove di successo e di blocco; i punti incompatibili sono dichiarati aperti,
senza ridefinire implicitamente il Gate 2 originario.

### 5. Suite finale e decisione

Prima della suite completa usare solo i controlli mirati necessari alle modifiche
in corso. A implementazione stabilizzata eseguire una volta la suite completa;
rieseguire selettivamente soltanto dopo una correzione o un risultato ambiguo.

1. `npm run check` e `npm test` con Node compatibile. Registrare passati,
   falliti e **saltati**: i test opt-in non sono coperti solo perché la suite
   standard è verde.
2. Eseguire i test mirati di broker, receiver, ripresa manuale e proxy Codex,
   inclusi recupero e casi negativi. Eseguire i gate opt-in pertinenti solo
   con runtime/fixture esplicitamente predisposti e risultati identificati.
3. Verificare OpenCode e Codex end-to-end con il percorso manuale: record
   prodotto dall'agente, arresto e conferma, trasferimento all'host, stessa
   conversazione e lavoro salvato, confronto, receiver di destinazione, task e
   accettazione. La prova Codex più recente usa il modello reale per scegliere
   e comporre claim e report MCP tra due operazioni spiegate dalla fixture; le
   impostazioni erano sintetiche. Non attribuire alla prova una verifica
   indipendente della configurazione.
4. Eseguire solo i test nativi effettivamente compatibili con i runtime
   originali; registrare separatamente prove isolate, piattaforme, versioni,
   componenti non attivati e criteri non dimostrati.
5. Rimuovere gli esatti artefatti temporanei creati dalla prova, verificare la
   pulizia locale/remota, e produrre una tabella requisito → prova → risultato →
   eventuale limite. Conservare profili e dati reali.

Preparazione: la fixture fisica OpenCode è indirizzata a Reborn e verifica le
copie ufficiali temporanee OpenCode 2.2.6 e Node 24.21.0 tramite SHA-256. Il
preflight locale OpenCode 2.2.6 con modello simulato è passato senza invio a
DeepSeek. Il catalogo OpenCode specifico è stato poi autorizzato esplicitamente
e la prova fisica completa Mac–Reborn con modello reale è passata l'8 novembre.
Il gateway rifiuta strumenti fuori dal catalogo approvato.
Il catalogo OpenCode sintetico approvato è conservato come
[`test/fixtures/approved-opencode-tools.json`](../test/fixtures/approved-opencode-tools.json) (SHA-256
`0040d0828c60e00ace8626ce6288ae08b1691b05b1192e69a752fef9fbe8136d`):
contiene i quattro strumenti Turnlink già richiesti, varianti OpenCode incluse,
più `channel_control`, `channel_session_context`, `read`, `write`, `edit`.
Per Codex il salvataggio privato è gestito da Turnlink al momento dell'invio
del record: non è necessario esporre strumenti shell al modello. La prova Codex
fisica è passata dapprima con i quattro schemi e poi con l'aggiunta dello schema
`channel_control`, successivamente autorizzato. Lo schema esatto approvato è
[`test/fixtures/approved-codex-control-tool.json`](../test/fixtures/approved-codex-control-tool.json),
SHA-256 `30c231035587886d09de1efa3f3e4ec139ec7cf51779751a9bfa54cbb14c5825`.

Decisioni distinte: **percorso manuale completato** solo se la prova completa e
il recupero passano; **Gate 2 originario chiuso** solo se anche le sue garanzie
native sono dimostrate o il loro perimetro viene modificato esplicitamente.

L'operatore ha successivamente autorizzato una chiusura con limiti dichiarati
per le garanzie non ottenibili dai runtime originali, dopo lo sviluppo e la
verifica dei controlli che Turnlink può applicare. Questa decisione non è una
prova delle garanzie native e non chiude automaticamente le attività Turnlink
ancora aperte. Il riesame della ripresa manuale espone i limiti operativi;
la conferma ricorda che il confronto dell'agente non verifica indipendentemente
istruzioni, strumenti e policy effettivamente caricati.

Il proxy Codex invalida anche le selezioni osservate quando vede una mutazione
globale o non classificata, sia all'invio sia alla risposta. Una risposta di
ripresa antecedente a una mutazione osservata non ristabilisce la selezione;
serve una nuova ripresa. La copertura rimane limitata alle richieste che passano
dal proxy e non dimostra la freschezza delle istruzioni interne del runtime.
Le due sequenze di risposta concorrente sono verificate con proxy e broker reali
e runtime simulato: il task resta bloccato e riparte dopo una nuova osservazione.
Il test mirato del proxy è passato con 13 casi. La suite standard successiva è
passata con 1.397 test riusciti, zero errori e 427 saltati; `npm run check` è
passato. I test saltati non sono coperti da questo risultato. Il test del broker
conferma separatamente che l'avviso è presente nella selezione e alla conferma.

Verifica standard dell'8 novembre dopo la precedente correzione del salvataggio: `npm run
check` passato; `npm test` ha prodotto 1.387 test passati, zero errori e 424
saltati. I casi saltati non sono inclusi tra le prove eseguite. Nello stesso
controllo sono passate nuovamente le prove fisiche Mac–Reborn per OpenCode e
Codex; in quella prova Codex claim/report erano eseguiti dalla fixture e le impostazioni
del record sono sintetiche. Le cartelle temporanee delle fixture su Reborn
sono state verificate assenti dopo entrambe le prove.
Successivamente il filtro della fixture DeepSeek Codex è stato esteso per
accettare, solo su richiesta esplicita e con hash esatto, uno schema di controllo
separatamente approvato; i test mirati del filtro e del gateway sono passati.
La successiva correzione del reinvio è stata verificata con test mirati e con
Codex locale e modello simulato; la suite standard e le prove fisiche qui sopra
non erano state ripetute a quel punto. La suite standard è stata poi rieseguita
sul codice aggiornato: 1.390 test passati, zero errori e 424 saltati;
`npm run check` è passato. Sono passate anche le prove fisiche OpenCode e Codex
Mac–Reborn, con gli stessi limiti già indicati per claim/report e impostazioni
sintetiche Codex. Le cartelle temporanee delle fixture sono state controllate
assenti sia localmente sia su Reborn dopo le prove.
Dopo la correzione degli ID di trasferimento annullati, la suite standard è
passata nuovamente con 1.391 test riusciti, zero errori e 424 saltati; anche
`npm run check` e 50 test mirati sono passati. Le prove fisiche riportate sopra
precedono questa ultima modifica e non coprivano il ciclo di annullamento.
Il successivo collegamento della guida al limite di tentativi è stato verificato
con `npm run check` e 51 test mirati di broker, selezione e recupero; la suite
completa citata precede quest'ultima modifica informativa.
Anche i comandi selezionati di subentro sono stati verificati con 51 test
mirati e `npm run check`, più i quattro scenari di subentro, inclusi il rifiuto
senza coordinatore attivo e dell'annullamento dopo completamento. La suite
completa citata precede questi comandi.
La successiva riconciliazione senza coordinatore attivo è stata verificata con
gli stessi test mirati: dopo riavvio e riassegnazione recupera l'intento già
commesso; un intento non commesso può essere annullato senza copiare ID, mentre
quello commesso non può essere annullato. Il lookup senza coordinatore è
riservato all'amministratore e richiede broker e CLI aggiornati insieme.
Sul protocollo aggiornato `npm run check` e la suite standard sono passati:
1.391 test riusciti, zero errori e 424 saltati. Le prove fisiche elencate sotto
precedono questa modifica al recupero del coordinatore.
Tre prove opt-in aggiuntive sul Codex ufficiale 0.165.0 sono passate con
storage e modello sintetici locali: ripresa del thread e delle istruzioni,
conservazione della cronologia e rifiuto di un secondo writer concorrente
sullo stesso storage. Il confine e ciò che non dimostra sono descritti nella
[matrice](gate-2-compatibility-matrix.md#fattibilità-delle-garanzie-native-con-i-runtime-invariati).
Una quarta prova ha rilevato che un `AGENTS.md` della destinazione modificato
dopo `thread/resume` non è stato aggiornato nel turno successivo; dopo arresto
e riavvio della stessa sessione è stato caricato il contenuto nuovo. È un
limite osservato del runtime 0.165.0: tra le due osservazioni il file sul disco,
l'oggetto `config` di `config/read`, i percorsi `instructionSources` di
`thread/resume` e l'ID thread erano uguali. Non dimostra
l'impossibilità di altre soluzioni né fornisce una verifica atomica delle policy.
Altre due prove sullo stesso runtime hanno verificato che `turn/start` può
cambiare la policy di approvazione e il modello nello stesso thread. Prove
separate del proxy con runtime simulato verificano che entrambi gli override
visti dal proxy invalidino la selezione precedente e blocchino il task fino a
una nuova osservazione. I sei test nativi e 27 test mirati di proxy/snapshot
sono passati.
È passato anche `test/opencode-service.test.js` con OpenCode 2.2.6 e le opzioni
di arresto, spostamento e rejoin attive, usando esclusivamente un progetto e un
modello sintetici locali. Il controllo dell'autorità ha correttamente rifiutato
di abilitare l'esecuzione con plugin dinamici non risolti; il test non è una
prova di esclusione nativa né di handoff completo.
È passato inoltre il test opt-in `test/codex-worktree-gate.test.js` con Codex
ufficiale e modello sintetico locale: nel thread reale la fixture ha esercitato
claim, report e accettazione tramite MCP, e verificato le istruzioni nella
worktree. Lo snapshot rimane non idoneo all'esecuzione; le chiamate sono scelte
dalla fixture e non costituiscono prova di handoff nativo di produzione.
È poi passata una prova fisica Codex Mac–Reborn con modello deterministico
locale: il thread originale usa MCP per claim e report, mentre la fixture
sceglie esplicitamente le chiamate e fornisce i dati sintetici. Non sono stati
inviati schemi o conversazioni a DeepSeek; le cartelle temporanee sono state
verificate assenti sul Mac e su Reborn. In seguito è passata anche la prova
fisica con DeepSeek e lo schema `channel_control` autorizzato: il modello ha
eseguito claim e report tramite MCP su istruzioni e argomenti espliciti della
fixture. Il coordinatore ha accettato il task; la chiave è rimasta sul Mac e le
cartelle temporanee sono state verificate assenti su entrambi gli host. Non è
una prova di decisione autonoma né di autorità completa della destinazione.
Una successiva prova più forte è passata sia localmente sia Mac–Reborn: il
modello ha scelto claim e report tra due operazioni presentate nella richiesta,
componendo le chiamate a partire dallo stato sintetico, dagli ID e dai campi
forniti. Un tentativo precedente della stessa prova era rimasto bloccato dopo
il rejoin, prima della richiesta di confronto; il task non è stato rilasciato
e la causa specifica non è stata identificata. Il successo successivo non
dimostra che quell'attesa non possa ripresentarsi. La fixture rinnova ora il
coordinatore e registra solo diagnostica limitata sui fallimenti del broker.
Una correzione separata copre un caso riproducibile: un rifiuto esplicito
temporaneo del broker durante la lettura dello stato destinazione veniva
ritentato con limite e backoff, anche senza un nuovo evento di presenza. Un
invio di confronto dall'esito incerto non viene ripetuto automaticamente. I
test mirati passano; non è stato dimostrato che il rifiuto riprodotto fosse la
causa dell'attesa osservata nella prova fisica.
Una riproduzione successiva ha mostrato che, esauriti sei tentativi, quel
controllo poteva rimanere fermo anche se il broker tornava disponibile senza
emettere nuovi eventi. La lettura di stato esplicitamente rifiutata continua
ora con backoff fino a cinque secondi; la regola non si applica a invii
dall'esito incerto. La riproduzione falliva prima della modifica e passa dopo.
Questo è un meccanismo plausibile dello stesso sintomo, non una prova della
causa del tentativo storico, per il quale non è disponibile diagnostica
sufficiente.
La prova fisica Mac–Reborn con Codex ufficiale e modello sintetico è passata
anche dopo sette rifiuti temporanei di stato iniettati nella fixture: rejoin,
confronto e task completato. La fixture ha simulato i rifiuti nel client del
coordinatore; non sono un guasto reale osservato sul broker. La prova senza
iniezione è passata separatamente e la pulizia della fixture è stata confermata
dalla procedura di test.
Dopo la correzione sono passati `npm run check`, 58 test mirati e la suite
standard (1.393 passati, zero errori, 424 saltati). La prova fisica successiva
con modello reale è scaduta prima della preparazione: il modello stava ancora
generando ragionamento. Non ha quindi verificato il codice aggiornato su
Reborn. La prova fisica successiva con modello simulato è passata sul codice
aggiornato; le fixture temporanee sono state verificate assenti su entrambi gli
host. La prova reale riuscita riportata sopra resta precedente alla correzione.
Una nuova prova fisica con DeepSeek è poi passata sul codice aggiornato:
record, arresto, rejoin, confronto e task accettato. Per isolare il recupero,
la fixture ha chiesto esplicitamente le chiamate MCP di claim e report; la
precedente prova in cui il modello sceglieva tra due operazioni resta distinta.
Il tentativo intermedio precedente non aveva raggiunto l'anteprima perché non
erano soddisfatte tutte le condizioni di coordinatore, claimant e connessione;
la causa specifica non era stata acquisita. Le fixture temporanee dell'ultima
prova sono state verificate assenti su entrambi gli host.
