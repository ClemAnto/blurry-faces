# Checklist BlurryFaces

## Fatto (16/11/2026)

- [x] Tracking per volto (IoU + distanza dei centri) al posto del fallback "riusa le detection solo se il frame è vuoto"
- [x] Pipeline in due passate: rileva su tutti i frame, poi interpola i buchi (fino a 1 s) ed estende ogni traccia di 0,5 s prima e dopo
- [x] Detection su tile sovrapposti per i frame grandi (volti piccoli/lontani)
- [x] Box allargati (fronte, capelli, mento), oscuramento ellittico proporzionale alla dimensione del volto, sempre opaco anche senza `ctx.filter`
- [x] Decodifica/codifica con WebCodecs via mediabunny: frame esatti, fps originali, niente frame in RAM, MP4 in uscita, audio originale copiato senza ricodifica
- [x] Gestione errori, pulsante Annulla, "Altro video", rilascio degli object URL, Elabora disabilitato finché il modello non è caricato
- [x] Rimossi codice Ionic morto, test rotti e ~200 MB di modelli inutilizzati
- [x] Test unitari sulla logica di tracking (`face-tracking.spec.ts`)
- [x] Angular 19 → 22, ng-zorro 22, Tailwind 4.3, builder `@angular/build` (esbuild) anche per i test
- [x] `deploy.yml`: action v4, `--frozen-lockfile`, rimosso lo step 404 inutile; `dist/` non più versionata
- [x] Test e2e Playwright (`yarn e2e`): UI, errori, annulla, MP4/WebM/ruotato/senza audio, controllo che i volti siano oscurati
- [x] Celle di oscuramento di almeno 5 px (i volti piccoli restavano quasi nitidi) ed ellisse allargata del 20% (copre gli angoli del box sui volti in movimento)

## Da fare

### Qualità del rilevamento
- [x] Confronto SSD / MediaPipe full-range su un video reale: default `combined` (0 volti scoperti contro 4 di SSD e 36 di MediaPipe, su 470)
- [x] Provati SCRFD-500M/10G e YOLOv8n-face via ONNX Runtime Web (WebGPU) e **scartati**. Su GPU Intel UHD integrata: 70–330 ms per inferenza (MediaPipe 10–17 ms, SSD ~90 ms); da soli lasciano scoperti 12–20 volti su 342 contro 1 del combinato SSD+MediaPipe; MediaPipe+YOLOv8n pareggia il combinato ma non è più veloce. Licenze problematiche (pesi InsightFace non commerciali, YOLO addestrato con Ultralytics AGPL). Ripetuto su RTX 3060 Laptop: SSD 19 ms, MediaPipe 12 ms, YOLOv8n 40 ms, SCRFD-10G 70 ms; da soli restano 15–26 volti scoperti su 353, e le combinazioni con MediaPipe non battono il combinato SSD+MediaPipe per tempo e copertura
- [x] **La GPU conta più del modello**: con Chrome sulla RTX invece che sulla Intel UHD integrata il combinato attuale è 3–3,6 volte più veloce (33 s di video in 47 s invece di 172 s). Su Windows Chrome usa l'integrata di default; si cambia da Impostazioni › Sistema › Schermo › Grafica › Chrome › Prestazioni elevate. Nei test: `E2E_HIGH_PERF_GPU=1`
- [ ] Suggerire nell'app di usare la GPU dedicata quando il renderer WebGL risulta una GPU integrata (Intel/AMD iGPU)
- [ ] Fase di revisione prima dell'export: timeline con i box, aggiunta/rimozione manuale sui frame critici
- [ ] Scelta del detector dalla UI (es. "rapida" = solo MediaPipe, circa 3 volte più veloce di SSD)
- [x] Prova su 5 video reali (gite e attività con bambini): corretto il caso dei volti tagliati dal bordo del fotogramma, che restavano scoperti perché il box veniva limitato al frame e l'ellisse si spostava verso l'interno
- [ ] Ripetere su altri tipi di video (controluce, notturni, folla lontana in 1080p/4K)
- [ ] Il controllo e2e usa gli stessi detector dell'app: i volti che nessuno dei due vede sfuggono anche al test, quindi resta necessaria una verifica a occhio

### Robustezza
- [x] Ripresa dell'ultimo lavoro interrotto (checkpoint su OPFS con versione e timestamp, copia locale del video), Web Lock contro il congelamento della tab, conferma prima di chiudere durante l'elaborazione
- [ ] Notifica a fine elaborazione e progresso nel titolo della tab (utile con la tab in background)
- [ ] Screen Wake Lock mentre la pagina è visibile, per evitare lo standby da inattività
- [ ] Salvare anche il risultato finito (oggi va riscaricato subito: un ricaricamento dopo la fine lo perde)

### Prestazioni
- [ ] **Priorità**: un video di 2 minuti in 1024×576 verticale ha richiesto 20 minuti (10× il tempo reale). Il detector combinato più i tile (frame > 960 px) fanno 6 inferenze per fotogramma
- [ ] Spostare la detection in un Web Worker con OffscreenCanvas: durante l'analisi il thread principale è saturo e la pagina risponde a fatica
- [ ] Modalità "rapida": detection a frame alterni, lasciando al tracking l'interpolazione
- [ ] Sui video 1080p e oltre i tile moltiplicano il costo per ~5: valutare tile solo ogni N frame

### Pulizia tecnica
- [ ] Ridurre il CSS iniziale (~600 kB): oggi si importa tutto `ng-zorro-antd.less`, basterebbero i componenti usati (supera il budget di 500 kB)
- [ ] Passare i componenti a `ChangeDetectionStrategy.OnPush` (la migrazione v22 ha messo `Eager` per compatibilità; lo stato è già tutto in signal)
- [ ] Verificare se servono ancora `provideHttpClient`, `FormsModule`, `provideAnimationsAsync`, `provideNzDateFnsAdapter`
- [ ] Migrare i test da Karma/Jasmine a Vitest (Karma è deprecato; per questo jasmine-core resta alla 5)
- [ ] Testare su Safari e Firefox (WebCodecs, codec H.264 in uscita): con Playwright basta aggiungere i progetti `firefox`/`webkit`
- [ ] Fixture e2e con volti in licenza libera da versionare, così i test sui volti girano anche in CI (oggi dipendono da un video locale)
- [ ] Eseguire `yarn test` e `yarn e2e` nella GitHub Action prima del deploy

### Funzionalità
- [ ] Scelta tra sfocatura, pixelato e riquadro pieno; intensità regolabile
- [ ] Stima del tempo rimanente
