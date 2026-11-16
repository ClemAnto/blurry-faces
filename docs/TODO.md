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
- [ ] Confrontare SSD MobileNet (face-api.js, fermo al 2020) con MediaPipe Face Detector full-range su un set di video di prova, soprattutto per volti di profilo e coperti
- [ ] Fase di revisione prima dell'export: timeline con i box, aggiunta/rimozione manuale sui frame critici

### Prestazioni
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
