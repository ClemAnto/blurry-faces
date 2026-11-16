# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Cos'è

BlurryFaces è una web app Angular 22 (standalone components, signals) che oscura i volti in un video **interamente nel browser**: rileva i volti con face-api.js, li traccia nel tempo e ricodifica il video in MP4 con WebCodecs (tramite mediabunny). Non c'è backend.

## Comandi

Package manager: **yarn** (c'è `yarn.lock`, la CI usa yarn e Node 22). Node è gestito con fnm: nelle shell bash non interattive compare un errore `fnm env` innocuo; i comandi git/yarn sono più affidabili da PowerShell.

- `yarn start`: dev server su http://localhost:4200 (i file nuovi in `public/` richiedono il riavvio)
- `yarn build`: build di produzione in `dist/` (`baseHref: ./`, routing con hash, per GitHub Pages)
- `yarn test --watch=false --browsers=ChromeHeadless`: Karma + Jasmine con il builder `@angular/build:karma`. Per un solo file: aggiungere `--include src/app/services/face-tracking.spec.ts`
- `yarn e2e`: test end-to-end con Playwright (~2 min) sul Chrome installato, avviando da solo il dev server sulla porta 4300. Un solo test: `npx playwright test -g "video ruotato"`.

### Test e2e

- **Fixture**: [e2e/global-setup.ts](e2e/global-setup.ts) le genera con **ffmpeg**, che deve essere nel PATH, in `e2e/.fixtures/` (cartella ignorata da git). I clip con volti si ritagliano da un video sorgente non versionato: di default `../face-api.js/examples/media/bbt.mp4`, oppure il file indicato con `FACES_VIDEO`. Se la sorgente manca, i test sui volti vengono saltati. Per rigenerare le fixture basta cancellare la cartella.
- **Controllo di privacy** (`checkAnonymization`): usa il detector dell'app tramite le API di debug `ng`, quindi funziona solo con il dev server.
  - Per ogni volto rilevato con sicurezza (score ≥ 0,5) nell'originale, verifica che nel risultato il dettaglio fine della zona non sia più correlato all'originale: correlazione dei Laplaciani ≤ 0,45.
  - Gli angoli del fotogramma fanno da controllo e devono restare sopra 0,5.
  - Non si conta semplicemente quanti volti trova il detector nel risultato, perché SSD a soglia bassa vede "volti" anche nelle macchie sfocate.
  - Il detector è lo stesso dell'app, quindi i volti che il modello non vede sfuggono anche al test.

## Architettura

- **Routing** ([src/app/app.routes.ts](src/app/app.routes.ts)): una sola route, `/lab`, lazy; `withHashLocation()` serve per GitHub Pages.
- **[LabComponent](src/app/views/lab/lab.component.ts)**: la UI (ng-zorro-antd + Tailwind). Selezione file, avvio, annulla, download, messaggi di errore.
- **[VideoProcessingService](src/app/services/video-processing.service.ts)**: la pipeline, in due passate sullo stesso `Input` di mediabunny.
  1. **Analisi**: `CanvasSink` decodifica ogni frame (fps reali, rotazione applicata). La detection gira con SSD MobileNet sul frame intero e, se il frame supera ~960 px, anche su tile sovrapposti. Il frame viene prima ridotto a un lato massimo di 1920 px. Si salvano solo i box, non le immagini.
  2. **Tracking** ([face-tracking.ts](src/app/services/face-tracking.ts), logica pura e testata): collega i box tra frame in tracce, interpola i buchi fino a 1 s, estende ogni traccia di 0,5 s prima e dopo, e allarga i box.
  3. **Rendering**: `Conversion` di mediabunny ridecodifica il video. Nel callback `process` si disegna il frame, si oscurano le aree e si restituisce un `VideoSample`. Il video viene ricodificato in MP4, mentre l'audio originale viene copiato quando possibile.

  Le due passate si allineano per timestamp, con `nearestIndex`. Lo stato verso la UI passa dai signal `phase`, `progress`, `preview` e `modelsReady`.
- **Oscuramento** (`anonymize`): l'area ellittica viene ridotta a circa 10 celle in larghezza e poi riallargata. Il primo disegno è sempre opaco, così l'oscuramento funziona anche dove `ctx.filter` non esiste; il blur via filtro si aggiunge solo dove è supportato. Per privacy si preferisce oscurare troppo piuttosto che troppo poco: i falsi positivi sono accettabili.
- **Modelli**: in [src/assets/models/](src/assets/models/) c'è solo `ssd_mobilenetv1`, l'unico usato.
- **[CustomIconsModule](src/app/shareds/custom-icons.module.ts)**: le icone Ant Design vanno registrate nell'array `ICONS`.
- **Stili**: tema ng-zorro in [theme.less](src/styles/theme.less) (richiede il pacchetto `less`), Tailwind v4 via PostCSS in [styles.scss](src/styles/styles.scss).
- **TypeScript**: `strict` attivo ma `strictNullChecks` disattivato.
- **mediabunny** è fissato a una versione esatta: aggiornarlo di proposito, verificando l'API di `Conversion`/`CanvasSink`.

La checklist dei lavori aperti è in [docs/TODO.md](docs/TODO.md).

## Branch e deploy

- **`release`** è il branch attivo. Ogni push su `release` avvia [.github/workflows/deploy.yml](.github/workflows/deploy.yml), che fa la build e pubblica `dist/` su `gh-pages` (serve il secret `GH_TOKEN`). `dist/` è ignorata da git.
- `main` è fermo al commit iniziale; `mobile` e `restart` sono branch storici già confluiti in `release`.
