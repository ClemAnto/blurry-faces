# Running long client-side computation in the background (hidden tab, minimized window, sleep, browser closed)

Context: in-browser video processing (WebCodecs, TF.js/MediaPipe on WebGL/WebGPU, canvas), jobs from 2 to 30 minutes, privacy rule that videos never leave the device. Research done 2026-11-16. Source quality is noted throughout: "official" means vendor docs or specs, "anecdotal" means forums, GitHub issues or blogs.

## 1. Hidden/background tab: timers, rAF, workers, WebCodecs/WebGL/WebGPU, promises

### Takeaway
In Chrome, a hidden tab mostly loses **timers** (1 wake-up per second, then 1 per minute after 5 minutes hidden for chained timers) and **requestAnimationFrame** (stops completely). A pipeline driven by rAF or chained `setTimeout` will stall or crawl. A pipeline driven by promises/awaits, WebCodecs callbacks and a dedicated worker is not hit by the documented timer rules. The official docs do not say whether workers or GPU APIs are throttled, so this has to be measured.

### Cited Findings
- Chrome has three timer-throttling tiers (official):
  - **Minimal:** applies when the page is visible or has made sound in the last 30 s; a silent audio track does not count. Only the 4 ms clamp applies, once the chain count reaches 5.
  - **Throttling:** applies when the page has been hidden under 5 min, OR the chain count is under 5, OR WebRTC is in use. Timers are checked once per second.
  - **Intensive throttling (Chrome 88+):** applies when the page has been hidden over 5 min AND the chain count is at least 5 AND the page has been silent for at least 30 s AND WebRTC is not in use. Timers are checked once per **minute**.
  — [Chrome: Timer throttling in Chrome 88](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)
- Exemptions from intensive throttling: audio playback in the last 30 s, or an `RTCPeerConnection` with an open data channel or a live media track — [Chrome 88 timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)
- `requestAnimationFrame` waits until the page is visible again, so it does not run while the page is hidden — [Chrome 88 timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88). Safari also stops rAF in hidden pages (anecdotal, from automation tooling) — [safari-mcp PR #199](https://github.com/achiya-automation/safari-mcp/pull/199)
- The Chrome 88 article does not say whether dedicated workers are affected — [Chrome 88 timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)
- In 2018 Chrome filed an "Intent to Implement and Ship: Throttling background dedicated workers". Its design doc says 43% of background-tab CPU went to dedicated workers, and the proposed throttling started after 10 s. I could not confirm whether it shipped in that form — [blink-dev intent](https://groups.google.com/a/chromium.org/d/topic/blink-dev/8xpEA-iNHwg)
- Reports on timers inside workers conflict, and all are anecdotal:
  - One Stack Overflow question says `setTimeout(…,100)` in a worker of a hidden tab fired at most once per second — [SO 61364663 (mirror)](https://kaweah.freedombox.rocks/kiwix/stackoverflow.com_en_all_2023-11/questions/61364663/does-web-worker-throttles-settimeout-setinteval)
  - An NW.js issue says the `--disable-background-timer-throttling` flag is ignored for worker timers — [lightrun/NW.js](https://lightrun.com/answers/nwjs-nw-js-is-it-possible-to-disable-throttling-of-worker--broadcast-channel-messages)
  - Other answers say worker `setInterval` is not throttled.
- The WebGPU spec explicitly allows browsers to "throttle operations on background tabs", to warn about heavy resource use, and to restrict which contexts can use WebGPU (normative permission, no specific behavior) — [W3C WebGPU](https://www.w3.org/TR/webgpu/)
- A GitHub report says a WebGPU compute benchmark keeps dispatching in hidden tabs, slowed only by timer throttling of its scheduling loop (anecdotal) — [GeoBradDev/WebGPU-Example #11](https://github.com/GeoBradDev/WebGPU-Example/issues/11)
- Effects of a **frozen** page (a different state from hidden): event handlers, timers and promise resolvers are suspended — [Chrome: Freezing on Energy Saver](https://developer.chrome.com/blog/freezing-on-energy-saver). While a page is only hidden and not frozen, no official source documents any throttling of promises or microtasks.
- Firefox (official bug tracker, older): background-window timers have a minimum delay set by `dom.min_background_timeout_value` (default 1000 ms). On top of that, a budget-based throttle charges each window the time its timers run; the budget regenerates at 10 ms per second, and the 2017-era defaults were a 50 ms max budget and a 15 s max delay — [Bugzilla 1377766](https://bugzilla.mozilla.org/show_bug.cgi?id=1377766), [dev-platform post](https://go.mail-archive.com/dev-platform@lists.mozilla.org/msg23775.html)

### Inferences
- The current pipeline is probably sequential: decode, then infer, then draw, then encode. If any step is paced by `requestAnimationFrame`, `setTimeout(0)` or `requestVideoFrameCallback`, it stalls when the tab is hidden. rAF stops completely; chained timers run at most 1 per second, then 1 per minute. Moving the loop to `await`-driven code inside a **dedicated worker**, with WebCodecs `VideoDecoder`/`VideoEncoder` callbacks, an `OffscreenCanvas`, and TF.js/MediaPipe in the worker, avoids every documented timer rule.
- Even so, WebGL inside a hidden page may get a lower GPU scheduling priority. No official statement was found; it must be measured.
- A hidden-tab test is needed: run the same job visible and hidden for over 5 minutes in Chrome, Edge, Firefox and Safari, logging frames per second from the worker. That is the only reliable answer for this specific stack.
- Firefox's budget throttle charges timer callbacks run on the window. A loop that yields with `setTimeout` on the main thread would be heavily slowed in a background Firefox tab, which is another reason to keep the loop in a worker or yield with `MessageChannel` or promises. This is inferred: the cited sources describe the budget but say nothing about MessageChannel or promise yields.

### Gaps
- No official current (2025–2026) Chrome, Firefox or Safari doc says whether **dedicated workers** in hidden tabs are throttled (timers or CPU priority). Evidence is conflicting and dated.
- No source found on whether **WebCodecs** encode/decode throughput, or **WebGL/WebGPU** throughput, drops in hidden tabs. Searches turned up no measurements.
- No authoritative source on Safari macOS timer throttling for hidden tabs.

## 2. Tab freezing and discarding (Page Lifecycle, Energy Saver, Memory Saver)

### Takeaway
Chrome can **freeze** hidden tabs: since Chrome 133 (Feb 2025), CPU-intensive tabs are frozen when Energy Saver is on. Chrome can also **discard** them under memory pressure. A 2–30 minute CPU/GPU job is exactly the "CPU-intensive" profile Energy Saver targets. Holding a **Web Lock** (or an IndexedDB connection that blocks operations outside the group) is a documented exemption from Energy Saver freezing. Discarding cannot be observed or prevented by the page, only detected after reload with `document.wasDiscarded`.

### Cited Findings
- The Page Lifecycle states are Active, Passive, Hidden, Frozen, Discarded and Terminated. When **Frozen**, freezable tasks are suspended; for example, JS timers and fetch callbacks do not run. When **Discarded**, the page is unloaded, no JS runs and no event fires, but the tab stays in the strip. The `freeze` and `resume` events arrived in Chrome 68, and `document.wasDiscarded` is available on desktop Chrome (Android support is tracked separately). Firefox and Safari do not support the API — [Chrome: Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api) (updated Oct 2026)
- Chrome avoids **discarding** hidden pages that have recently played audio, used WebRTC, updated the tab title or favicon, shown alerts, or sent push notifications, unless resources are extremely constrained. The heuristics may change — [Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)
- Lifecycle advice from the same doc:
  - Save state while hidden; that is the last reliable point.
  - Before freezing, close IndexedDB and BroadcastChannel connections, and release Web Locks.
  - Use `IDBTransaction.commit()`.
  - Use `pagehide`, not `unload`.
  — [Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)
- **Freezing on Energy Saver (Chrome 133, published 20 Jan 2025).** A browsing context group is frozen when all of these hold:
  - all its pages have been hidden and silent for over 5 min;
  - some same-origin frame subgroup is "CPU-intensive" (no numeric threshold given; may change);
  - it is not doing audio/video conferencing (mic, camera, screen capture, or RTCPeerConnection with an open data channel or live track);
  - it is not controlling WebUSB, Web Bluetooth, WebHID or Web Serial devices;
  - it does not hold a **Web Lock** or an IndexedDB connection that blocks operations outside the group.

  When frozen, event handlers, timers and promise resolvers are suspended. The tab unfreezes when focused, with state preserved. Eligibility can be checked at `chrome://discards`. Users can turn Energy Saver off or exclude sites at `chrome://settings/performance`. The `BackgroundPageFreezeOptOut` origin trial lets sites opt out until APIs such as the Progress Notification API ship — [Chrome: Freezing on Energy Saver](https://developer.chrome.com/blog/freezing-on-energy-saver)
- The CPU threshold is calibrated to freeze roughly 10% of background tabs when Energy Saver is active (secondary summary of the Chrome blog and the blink-dev intent) — [blink-dev Intent to Ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/OVoSqEhtpNI)
- Energy Saver (freezing, CPU) and Memory Saver (discarding, memory) are separate features — [Chrome blog](https://developer.chrome.com/blog/freezing-on-energy-saver)

### Inferences
- For this app, with Energy Saver active (it is often on automatically on battery), a hidden tab doing 100% CPU/GPU work for over 5 minutes is the textbook freezing target. Holding a Web Lock for the whole job, `navigator.locks.request('job', async () => { await job(); })`, is the **documented** way to stay exempt. This is the most important cheap mitigation.
- The Page Lifecycle doc's advice to release Web Locks before freezing is aimed at pages that want to be freezable, which contradicts holding the lock to stay exempt. Here the lock should stay held for the whole job.
- The Web Lock does **not** protect against Memory Saver discarding: the documented discard opt-outs are audio, WebRTC, title/favicon updates, alerts and push. Updating `document.title` or the favicon with progress is therefore useful twice: as UX, and as a discard-avoidance heuristic. Large video buffers and ML models make the tab a memory-heavy discard candidate.
- Discarding cannot be prevented, so checkpointing (section 6) is the only robust defence.

### Gaps
- Not documented whether a frozen page's **dedicated workers** are also suspended. The Energy Saver article speaks only of "browsing context groups". Chromium is believed to pause workers with their frozen page, but no source confirms it.
- The `BackgroundPageFreezeOptOut` origin trial's end date and status at end of 2026 were not found.
- The exact current Memory Saver discard thresholds were not researched; the official doc says they may change.

## 3. Mobile: Android Chrome and iOS Safari, PWA

### Takeaway
On **iOS**, JS stops within seconds once Safari is backgrounded or the screen locks, and Apple says this is intentional and cannot be controlled. On **Android Chrome**, background tabs are frozen after about 5 minutes hidden (since around Chrome 77/2019, older sources). Media playback is exempt, but Android may kill the whole browser process anyway. On a phone, a 2–30 minute job realistically requires the app in the foreground with the screen on.

### Cited Findings
- **iOS Safari:** in an Apple Developer Forums thread (Mar 2025), a counter page with `setInterval` stopped about 7–8 s after Safari went to the background. An Apple Frameworks Engineer replied: "If you are trying to keep running UI when the app itself is in the background, you cannot control this… On iOS it is very intentional to prevent this kind of behavior." The suggested workarounds were to derive state from a reference timestamp and to detect visibility — [Apple Developer Forums 777860](https://developer.apple.com/forums/thread/777860)
- The same Apple engineer said that on macOS, service workers or background scripts can be used for tasks. No details were given — [Apple forums 777860](https://developer.apple.com/forums/thread/777860)
- iOS unloads the service worker when the screen is locked (anecdotal, about Safari Web Extensions) — [Apple forums 757926](https://developer.apple.com/forums/thread/757926)
- **Android Chrome:** background tabs are reportedly "frozen" after 5 minutes hidden, starting with Chrome 77. The clock starts when the tab is hidden, and a reloaded hidden tab freezes again 5 min after reload (anecdotal, issues and blogs from 2019–2026) — [search summary of mixmaxhq issue #11](https://github.com/mixmaxhq/meteor-smart-disconnect/issues/11), [die-net/phoneapi PR #21](https://github.com/die-net/phoneapi/pull/21), [TencentCloud/octop-browser #24](https://github.com/TencentCloud/octop-browser/issues/24)
- Older (2018): Chrome Android's `StopLoadingInBackground` flag stops loading tasks for renderers in the background over 5 min; picture-in-picture media playback is exempt — [XDA, Jul 2018](https://www.xda-developers.com/google-chrome-android-stop-background-tabs/), [Chromium CL 1139042](https://chromium-review.googlesource.com/c/chromium/src/+/1139042)
- `document.wasDiscarded` is documented for desktop Chrome; Android support is tracked separately — [Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)

### Inferences
- An installed PWA (standalone) on iOS is still a WebKit web view subject to the same app-suspension rules. No source found grants a PWA more background time on either platform.
- On Android, switching apps also puts Chrome in the background, and the OS may kill its renderer under memory pressure regardless of Chrome's policy. Checkpoint/resume plus a "keep the screen on" UX (Screen Wake Lock) is the realistic design.

### Gaps
- No official Apple doc gives timings for suspension of web content (dedicated workers, WebCodecs, WebGL) when Safari is backgrounded. Only the forum statement is available.
- No current official Chromium doc for Android tab freezing thresholds; the exact timings rest on older or anecdotal sources.
- Not verified whether audio playback keeps JS (and workers) running in a backgrounded Android Chrome tab for the full job length.

## 4. Device sleep/standby: Screen Wake Lock and System Wake Lock

### Takeaway
The **Screen Wake Lock API** is Baseline 2025, supported by Chrome, Safari 16.4+ and Firefox. It keeps the screen on and stops the device locking or dimming, but **only while the page is visible**: it is released automatically when the tab is hidden or the user switches tabs. A **system** wake lock (keeping the CPU awake with the screen off) does **not** exist on the web. It was dropped from the spec and is now only a motivation in the Progress Notification proposal.

### Cited Findings
- `navigator.wakeLock.request('screen')` prevents the screen from turning off, dimming or locking. The browser may reject the request, for example in power save mode, at low battery, or when the document is not visible. The lock is released when the document becomes hidden or inactive, and must be re-requested on `visibilitychange`. The API requires a secure context, is gated by the `screen-wake-lock` Permissions-Policy, and is Baseline 2025 (since March 2025) — [MDN: Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
- iOS 16.4+ supports it while the page is visible (secondary). Older tutorials saying iOS lacks support are out of date — [search summary](https://www.w3tutorials.net/blog/prevent-ios-mobile-safari-from-going-idle-auto-locking-sleeping/)
- The "system" wake-lock type was considered and dropped; only `"screen"` is exposed (secondary) — [testmuai guide](https://www.testmuai.com/learning-hub/wake-lock-api-browser-support/); history of pairing system wake locks with progress reporting — [W3C DAP minutes 2019](https://www.w3.org/2019/09/20-dap-minutes.html)
- The **Progress Notification API** explainer (Googlers Reilly Grant and Ayu Ishii) names "video or image processing" as a key scenario. It notes that long work can be interrupted when the device sleeps or the tab is backgrounded, and that browsers hold implicit wake locks today (system lock during audio playback, screen lock during video playback). The proposed API is `new ProgressNotification(title, {type})`, with `.update(progress, timeRemaining)` and `.close()`, exposed on Window and Worker. Browsers *could* then skip freezing and timer throttling for the page. It is still an explainer — [GitHub explainer](https://github.com/explainers-by-googlers/progress-notification); [blink-dev Intent to Prototype](https://www.mail-archive.com/blink-dev@chromium.org/msg11510.html)

### Inferences
- When a laptop lid closes or the OS sleeps, all processes are suspended by the OS. The job does not run during sleep, but in-memory JS state normally survives and continues on wake, unless the OS hibernates and the browser is restarted. No web API can prevent lid-close sleep. Screen Wake Lock only prevents **idle** sleep, and only while the tab is visible, which still helps: "start the job and leave the laptop open" works.
- The "implicit system wake lock while audio plays" in the explainer suggests that playing audio might also keep the system awake on some platforms. That is undocumented behavior and a side effect, not a contract.
- After resume from sleep, GPU contexts may be lost (WebGL `webglcontextlost`, WebGPU `device.lost`), and pending WebCodecs operations may error. The pipeline should handle these and restart from the last checkpoint. This is inferred from general GPU API design; no specific source was found.

### Gaps
- No source found on what exactly happens to WebGL/WebGPU contexts and WebCodecs codecs across OS sleep/resume in each browser.
- Exact current Firefox and Safari version numbers for wake lock support were not retrieved; MDN only states Baseline 2025.

## 5. Browser closed: Service Workers, Background Fetch/Sync, and alternatives

### Takeaway
No web API lets heavy computation run with the browser (or the page) closed. Service workers are event-driven and killed after about 30 s idle or long-running tasks. Background Fetch only downloads. Background Sync and Periodic Sync are short network-oriented events. For true "close the window" behavior, the only options are wrappers such as Electron/Tauri or a browser extension, or **resume-on-reopen** through checkpointing.

### Cited Findings
- Chrome terminates an **extension** service worker after 30 s of inactivity, or when a single request runs over 5 minutes. Since Chrome 110, pending events reset the idle timer — [Chrome 110 announcement](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/_RxghHKGQ8s), [Chrome: Longer extension SW lifetimes](https://developer.chrome.com/blog/longer-esw-lifetimes), [Extension SW lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- For web service workers, Chrome's Service Worker Security FAQ (quoted in a forum) says a worker is terminated after 30 s idle, and that Chrome "detects long-running workers and terminates them". The FAQ itself was not checked directly — [chromium-extensions thread](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/L3EbiNMjIGI)
- iOS unloads service workers on screen lock (anecdotal) — [Apple forums 757926](https://developer.apple.com/forums/thread/757926)
- The Progress Notification explainer defers "extending service worker lifetimes" to a Phase 2. Today there is no mechanism to keep a service worker computing — [explainer](https://github.com/explainers-by-googlers/progress-notification)

### Inferences
- Service workers cannot use WebGL. WebGPU in service workers is limited or absent depending on the browser. Combined with the lifetime limits, a service worker is not a computation host.
- **Background Fetch** transfers network data only. **Background Sync** and **Periodic Background Sync** fire short SW events, with Periodic Sync limited to Chromium and installed PWAs. None of them allows minutes of CPU/GPU work. This is general platform knowledge; these APIs were not re-verified in this session.
- The realistic alternatives:
  - **Electron/Tauri wrapper:** native process, no tab throttling; Electron has `backgroundThrottling: false` and `powerSaveBlocker`. Keeps everything local, so it fits the privacy requirement, but it is a separate distribution channel.
  - **Chrome extension with an offscreen document:** possible, but heavy and Chrome-only.
  - **Resume-on-reopen:** checkpoint to OPFS/IndexedDB and continue when the user reopens the page.
- Server-side processing is excluded by the privacy requirement.

### Gaps
- Official Safari and Firefox web service worker termination timings were not found in this session.
- Not verified: Chrome desktop PWA "Run on OS login" status, and Electron/Tauri specifics (no sources fetched).

## 6. Workarounds in practice: reliability and acceptability

### Takeaway
Ranked by robustness, from most to least robust:
1. **Checkpoint/resume** (OPFS/IndexedDB): survives freeze, discard, crash, reload and sleep.
2. **Hold a Web Lock** during the job: documented exemption from Energy Saver freezing.
3. **Run the loop in a dedicated worker driven by promises, not rAF or timers:** avoids documented timer throttling.
4. **Screen Wake Lock plus a "keep this tab open" UX**, with a visibility warning.
5. **Progress in title/favicon** (UX, and a discard-avoidance signal) and a **Notification** on completion.

Silent audio is a hack: a *silent* track does **not** count as audible for timer exemptions.

### Cited Findings
- A **silent** audio track does not exempt a page from intensive timer throttling; only audible sound in the last 30 s does — [Chrome 88 timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88). Freezing on Energy Saver also requires the page to be "silent", so audible audio exempts it — [Freezing on Energy Saver](https://developer.chrome.com/blog/freezing-on-energy-saver)
- **Web Lock** held, or an IndexedDB connection blocking outside operations: exempts the page from Energy Saver freezing — [Freezing on Energy Saver](https://developer.chrome.com/blog/freezing-on-energy-saver)
- **Title/favicon updates**, audio, WebRTC, alerts and push: heuristics that make Chrome avoid **discarding** a hidden tab — [Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)
- **WebRTC** (RTCPeerConnection with an open data channel): exempts the page from intensive timer throttling and from Energy Saver freezing (counted as conferencing) — [Chrome 88](https://developer.chrome.com/blog/timer-throttling-in-chrome-88), [Energy Saver freezing](https://developer.chrome.com/blog/freezing-on-energy-saver). A loopback peer connection is a known hack, but it is clearly against the spirit of the rules and may be closed off.
- The Blink "Intent to Prototype: Progress Notification API" acknowledges that users today work around browser behavior to finish long tasks, by preventing discards or stopping the system from sleeping. The Progress Notification API is meant to replace such hacks — [blink-dev](https://www.mail-archive.com/blink-dev@chromium.org/msg11510.html)
- Save state while hidden; use `IDBTransaction.commit()`; check `document.wasDiscarded` at load to restore — [Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)
- On iOS, the recommended pattern is to detect `visibilityState` and derive progress from stored timestamps; the page cannot keep running — [Apple forums 777860](https://developer.apple.com/forums/thread/777860)
- WebGPU readback pacing note (perf, not lifecycle): a serial await-readback loop left the GPU about 60% idle on an M2 with Chrome; double-buffering is recommended (blog, anecdotal) — [SitePoint WebGPU concurrency guide](https://www.sitepoint.com/the-webgpu-concurrency-guide-mastering-async-compute-shaders/)

### Inferences
Recommended design for this app (client-only):
1. Run the decode, detect, blur and encode pipeline in a dedicated worker, using OffscreenCanvas and TF.js/MediaPipe in the worker, paced by promises and WebCodecs callbacks, never rAF or `setTimeout`.
2. Wrap the job in `navigator.locks.request(...)`.
3. Request a Screen Wake Lock at start, and re-request it on `visibilitychange` back to visible.
4. Show progress in `document.title` and the favicon.
5. On `visibilitychange` to hidden, show a banner, plus an explicit mobile warning: "on iPhone, processing pauses when you leave the page".
6. Checkpoint every N seconds or segments to OPFS: encoded chunks written so far, last processed timestamp, and tracker state. Follow the global rule for local saves: record the app version and a `performance.timeOrigin + performance.now()` timestamp, and validate both on load. On load, use `document.wasDiscarded` or the presence of a checkpoint to offer "Resume".
7. Send `new Notification(...)` on completion, after getting permission at job start. On iOS this only works for an installed PWA, and only while the page is running.
8. Optional: an audible-audio "keep alive" switch is technically effective in Chrome but bad UX. A loopback WebRTC trick is abusive and fragile; avoid both.
9. Watch for the Progress Notification API; join the `BackgroundPageFreezeOptOut` origin trial only if it is still running.

The video file itself must be re-readable after reload for resume to work: keep it in OPFS, or keep a File System Access handle (Chromium) stored in IndexedDB, rather than relying on an `<input type=file>` `File` that is lost on reload. This is inferred; not verified for each browser.

### Gaps
- No measurements found of how often Chrome Memory Saver discards a heavy tab (models plus video buffers) during a job.
- Notifications API behavior on iOS PWAs (permission flow, delivery while suspended) was not verified in this session.
- No 2025–2026 hands-on reports found for this exact stack (WebCodecs plus TF.js in a worker) in a hidden tab. This should be tested internally with Chrome, Firefox and Safari.

## 7. Safari and Firefox differences (summary)

### Takeaway
Only Chromium implements Page Lifecycle (freeze/resume, `wasDiscarded`) and Energy Saver freezing. Firefox throttles background timers with a budget model and a 1 s minimum delay. Safari on iOS suspends everything when backgrounded; macOS Safari's policy is poorly documented. All three support Screen Wake Lock (Baseline 2025).

### Cited Findings
- Page Lifecycle API: supported in Chrome 68+ and Edge 79+, not in Firefox or Safari — [Chrome docs](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)
- Firefox background timers: minimum delay of 1000 ms, plus budget throttling (regenerating at 10 ms/s, historical max delay of 15 s) — [Bugzilla 1377766](https://bugzilla.mozilla.org/show_bug.cgi?id=1377766), [dev-platform](https://go.mail-archive.com/dev-platform@lists.mozilla.org/msg23775.html)
- iOS Safari: background JS stops within seconds, intentionally — [Apple forums](https://developer.apple.com/forums/thread/777860)
- Screen Wake Lock: Baseline 2025 across browsers — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)

### Inferences
- In Firefox and macOS Safari, there is no freeze event to react to. Rely on `visibilitychange` and `pagehide` for checkpointing, and on periodic checkpoints.

### Gaps
- Current Firefox defaults (2025–2026) for the budget throttling prefs, and whether workers are exempt, were not confirmed.
- No documentation found for macOS Safari hidden-tab throttling or its "Safari suspends background tabs to save energy" behavior. This needs a hands-on test.
