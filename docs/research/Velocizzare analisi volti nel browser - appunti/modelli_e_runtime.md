# Faster face detection models and browser runtimes/architectures for offline client-side video face anonymization

Research date: 2026-11-16. Scope: browser-runnable face detectors (accuracy and recall on hard faces), inference runtimes (ORT Web, TF.js, MediaPipe, LiteRT.js), and pipeline architecture (workers, WebCodecs, zero-copy, parallelism). App baseline: face-api.js SSD MobileNet v1 (tfjs-core 1.7, WebGL) plus MediaPipe BlazeFace full-range (GPU, IMAGE mode), full frame plus overlapping tiles above 960 px, all on the main thread. About 50–60 ms per inference, 4–10x slower than realtime.

## Q1. Model comparison: which browser-runnable face detectors are fastest and most accurate (recall on small, profile, tilted, occluded faces)?

### Takeaway
On WIDER FACE Hard, the best proxy for small, occluded and posed faces, the ranking at a similar ~1–3 GFLOPs budget is: SCRFD-2.5G (77.9 Hard) ≈ YOLOv5n-face (80.5) > YuNet (~75) > YOLOv5n-0.5 face (73.8) > SCRFD-0.5G (68.5) >> RetinaFace-MobileNet0.25 (47.3) ≈ UltraFace RFB-320 (43.8 at 320 px). SCRFD-10G (83.0) and YOLOv8n/v11n-face (~79–85 Hard, community numbers) are the step up. All are ONNX-exportable and run in ONNX Runtime Web. BlazeFace (MediaPipe) is tiny and fast but has no published WIDER FACE numbers and a 128-input design meant for selfie or near-range faces. For recall, an ORT Web model such as SCRFD-2.5G/10G or YOLOv8n/11n-face at 640 input is the strongest candidate to replace both current detectors.

### Cited Findings
**SCRFD (InsightFace, 2021, still the reference lightweight family)**
- Official pretrained table (WIDER FACE val, VGA 640x480 single scale), Easy/Medium/Hard, FLOPs, params, infer ms: SCRFD_500M 90.57/88.12/68.51, 0.5 GF, 0.57M, 3.6 ms; SCRFD_1G 92.38/90.57/74.80, 0.64M, 4.1 ms; SCRFD_2.5G 93.78/92.16/77.87, 0.67M, 4.2 ms; SCRFD_10G 95.16/93.87/83.05, 3.86M, 4.9 ms; SCRFD_34G 96.06/94.92/85.29, 9.80M, 11.7 ms. KPS (landmark) variants: 500M_KPS 90.97/88.44/69.49; 2.5G_KPS 93.80/92.02/77.13; 10G_KPS 95.40/94.01/82.80. The README does not state the GPU used for the ms timings. — [InsightFace SCRFD README](https://github.com/deepinsight/insightface/blob/master/detection/scrfd/README.md)
- Same README, mobile-family comparison: RetinaFace (MobileNet0.25) 87.78/81.16/47.32, 0.44M params, 0.802 GFLOPs, 7.9 ms. SCRFD-0.5GF CPU test: 28.3 ms single-thread at 640x480 on a Ryzen 9 3950X (PyTorch, OMP_NUM_THREADS=1). — [InsightFace SCRFD README](https://github.com/deepinsight/insightface/blob/master/detection/scrfd/README.md)
- The paper reports that SCRFD-0.5GF beats RetinaFace-M0.25 by 21.19% on Hard AP. — [SCRFD paper, arXiv 2105.04714](https://arxiv.org/pdf/2105.04714)
- A ready-made ONNX export exists on Hugging Face. — [RuteNL/SCRFD-face-detection-ONNX](https://huggingface.co/RuteNL/SCRFD-face-detection-ONNX)
- A browser face-swap pipeline uses SCRFD at 640x640 on WebGPU and re-runs it at fixed intervals between optical-flow tracking steps. No timings are given. — [dev.to: browser-local video face swapping on WebGPU](https://dev.to/martindelophy/building-browser-local-video-face-swapping-lessons-from-a-webgpu-inference-pipeline-5dm5)

**YuNet (OpenCV Zoo, libfacedetection)**
- OpenCV Zoo model card, WIDER FACE Easy/Medium/Hard: YuNet 0.8844/0.8656/0.7503; int8 0.8810/0.8629/0.7503; block-int8 0.8845/0.8652/0.7504. The same card's intro states 0.834/0.824/0.708, an unexplained inconsistency. Detects faces of about 10x10 to 300x300 px and accepts dynamic input shape in OpenCV DNN. File: face_detection_yunet_2023mar.onnx. — [OpenCV YuNet model card (HF)](https://huggingface.co/opencv/face_detection_yunet/blob/main/README.md)
- The YuNet paper (Machine Intelligence Research, 2023) gives 81.1% mAP single-scale on WIDER FACE val Hard under its own protocol. libfacedetection reports 0.887/0.871/0.768 with confidence_threshold=0.02. The protocols differ, so the numbers are not comparable with the Zoo's. — search summary of [Springer MIR paper](https://link.springer.com/content/pdf/10.1007/s11633-023-1423-y.pdf) and [libfacedetection mirror](https://gitee.com/mirrors/libfacedetection)
- A "2026may" dynamic-input YuNet re-export has the same weights as 2023mar. — [pollen-robotics/face_detection_yunet_2026may](https://huggingface.co/pollen-robotics/face_detection_yunet_2026may)
- A single-author test reports ~9.2 ms per inference on a 1280x720 image (int8, native OpenCV, hardware unclear) and notes that small far-away faces need upscaling to be detected. — [dev.to: YuNet speed and scale invariance](https://dev.to/kiarina/high-speed-face-detection-and-scale-invariance-with-opencv-yunet-4m7f)
- YuNet runs in about 1.6 ms per frame at 320x320 on CPU (secondary aggregator, unverified). — [ufme-docs SOTA detection page](https://ufme-docs.pages.dev/research/sota-detection)

**YOLO-face family**
- yolov5-face README: yolov5n-0.5 (ShuffleNetv2 backbone) 90.76/88.12/73.82, 0.447M params, 0.571 GFLOPs; yolov5n 93.61/91.52/80.53, 1.726M params, 2.111 GFLOPs; yolov5s 94.56/92.92/83.84. — [YOLO5Face, arXiv 2105.12931](https://arxiv.org/abs/2105.12931v2), [yolov5-face fork README](https://github.com/Laughing-q/yolov5-face)
- YOLOv11n face (community fine-tune, 225 epochs on WIDER FACE): val AP 0.942/0.921/0.810. — [AdamCodd/YOLOv11n-face-detection](https://huggingface.co/AdamCodd/YOLOv11n-face-detection)
- yolo11face (zjykzj) reports Hard val AP ~0.852 for one run and a YOLOv8-pose variant with keypoints (Feb 2025). — [ecosyste.ms yolo11face](https://science.ecosyste.ms/projects/14521)
- YOLOv8n-Face at 640 input: Hard 79.0 (one comparison table). Another YOLOv8-Face repo spans Hard 0.60–0.79 depending on variant and multi-scale testing. — [ecosyste.ms 18176](https://science.ecosyste.ms/projects/18176), [Yusepp/YOLOv8-Face](https://awesome.ecosyste.ms/projects/github.com%2FYusepp%2FYOLOv8-Face)
- A YOLO11 face model ships fixed 640x640 ONNX in FP32/FP16/INT8. Its INT8 version gave zero detections unless the detection head stayed in float, which is a practical quantization pitfall. — [Banaxi-Tech/face-model](https://huggingface.co/Banaxi-Tech/face-model)
- YOLO licensing (Ultralytics YOLOv8/11 is AGPL-3.0) was not verified in this pass. See Gaps.

**UltraFace (Ultra-Light-Fast-Generic-Face-Detector-1MB)**
- version-RFB at 320x240: 0.787/0.698/0.438. At 640x480: 0.855/0.822/0.579. Very weak on Hard. — [Linzaer repo](https://WWW.GITHUB.COM/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB), [biubug6 Face-Detector-1MB](https://github.com/biubug6/Face-Detector-1MB-with-landmark)

**MediaPipe BlazeFace variants**
- Current Face Detector docs list BlazeFace short-range, full-range and full-range sparse, all "128 x 128" input and float16. Short-range latency on Pixel 6 is 2.94 ms CPU and 7.41 ms GPU. Full-range latencies are not listed, and Web code samples load only blaze_face_short_range.tflite. Sparse is "roughly 60% smaller" than full-range. — [MediaPipe Face Detector docs](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector)
- Legacy models doc: short-range is "best for faces within 2 meters", full-range dense and sparse "within 5 meters". Dense and sparse have the same F-score, but "The dense model is slightly better in Recall whereas the sparse model outperforms the dense one in Precision". Sparse is ~30% faster on CPU (XNNPACK), and GPU latencies are comparable. — [MediaPipe models.md mirror](https://cdn.jsdelivr.net/npm/@subhajit-gorai/react-native-mediapipe-llm@1.0.3/mediapipe/docs/solutions/models.md)
- BlazeFace paper: 200–1000+ FPS on flagship mobile GPUs (short-range, front-camera design). — [BlazeFace, arXiv 1907.05047](https://alphaxiv.org/abs/1907.05047)
- A WebGPU face-mesh library built on BlazeFace short-range reports a 3.3 ms median (custom WebGPU shaders) versus MediaPipe 5.2 ms on WebGPU and 6.1 ms on WASM, on a Mac mini M4 Pro with Chrome 134. Self-reported. — [micro-facemesh README](https://cdn.jsdelivr.net/npm/@svenflow/micro-facemesh@0.1.2/README.md)

**face-api.js detectors**
- @vladmandic/face-api keeps only tinyFaceDetector and ssdMobilenetv1 (mtcnn removed as "mostly obsolete", tinyYolov2 removed). Its own docs state it "is completely superseded by the newer library Human". — [vladmandic/face-api docs index](https://docsearch.algolia.com/mcp/docs/repo/vladmandic/face-api)
- No WIDER FACE numbers were found for face-api.js SSD MobileNet v1 or TinyFaceDetector.

### Inferences
- Replacing face-api SSD MobileNet v1 with SCRFD-2.5G or SCRFD-10G (ONNX, 640 input) should improve recall on hard faces and be cheaper per inference. SCRFD-10G is 10 GFLOPs at VGA, and SCRFD-2.5G is 2.5 GFLOPs. Both are anchor-based with multi-stride heads (8/16/32), so stride 8 covers faces down to ~10–16 px at 640 input. That reduces the need for tiling.
- BlazeFace at 128 input (full-range is possibly 192 in legacy builds, unverified) downsamples a 1080p frame by ~8–15x. Small faces disappear, which explains why tiling was needed. SCRFD or YOLO at 640 needs far fewer tiles for the same minimum face size: for 1920x1080, 2–3 tiles of 640 instead of many.
- Because recall matters most, run at a low score threshold (e.g. 0.3) and rely on temporal tracking and NMS to suppress false positives. Blurring a false positive is cheap. Missing a face is the failure mode.
- RetinaFace-MobileNet0.25 and UltraFace are clearly dominated (Hard 47 and 44) and should be excluded.
- YOLOv8n/11n-face reach Hard ~79–85 (self-reported) at ~3–8 GFLOPs. They are a viable alternative to SCRFD, but check the AGPL licensing of Ultralytics-derived weights. yolov5-face (deepcam) is GPL-3.0 per its repo (unverified here).

### Gaps
- No published side-by-side browser (ORT Web WebGPU/WASM) ms-per-frame numbers for SCRFD, YuNet or YOLO-face were found. They must be measured in-app.
- No WIDER FACE AP was found for MediaPipe BlazeFace (any variant) or for face-api.js SSD/Tiny. The BlazeFace model cards (mediapipe.page.link/blazeface-back-mc) were not retrieved.
- Input size of BlazeFace full-range: the current docs say 128x128 for all variants. I recall 192x192 for the legacy full-range model but could not verify it.
- No specific 2025–2026 lightweight face detector beating SCRFD at equal FLOPs was found in this pass. Most new work is YOLO fine-tunes.
- Profile and tilted-face-specific metrics are not reported separately. WIDER Hard is only a proxy.

## Q2. Runtimes: ORT Web (WebGPU/WebGL/WASM/WebNN), TF.js WebGPU vs WebGL, MediaPipe GPU delegate, LiteRT.js, transformers.js. Typical speedups and batching

### Takeaway
For small CNN detectors, the 2026 options are ONNX Runtime Web with the WebGPU EP (IO binding, graph capture, gpu-buffer outputs) and the new LiteRT.js (Google, July 2026, .tflite on WebGPU via ML Drift, WASM/XNNPACK, experimental WebNN). Vendors claim GPU is 5–60x over CPU (LiteRT.js) and WebGPU about 3x over WebGL (TF.js). For tiny models the gap is much smaller, and upload/readback overhead dominates. tfjs-core 1.7 with WebGL is ~6 years out of date, so moving off it is likely a large win on its own.

### Cited Findings
- ORT Web WebGPU EP: "available out-of-box in latest versions of Chrome and Edge on Windows, macOS, Android and ChromeOS". Import `onnxruntime-web/webgpu`, `executionProviders: ['webgpu']`. Without IO binding, "the data is copied to GPU memory, and the results are copied back to CPU memory". `Tensor.fromGpuBuffer()` accepts an existing WebGPU buffer as input. `preferredOutputLocation: 'gpu-buffer'` keeps outputs on the GPU. Graph capture applies to static-shape models whose kernels all run on WebGPU and "may potentially improve the performance". For "very lightweight models" the doc suggests staying on the WASM EP. — [ORT Web WebGPU tutorial](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)
- The graph-capture option is `enableGraphCapture` (WebGPU EP only). — [ORT env flags and session options](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html). With capture on, the first run captures and outputs are switched to gpu-buffer. — [ORT commit](https://github.meowingcats01.workers.dev/microsoft/onnxruntime/commit/73640b6f0c92f1195f33e97e688ab2372eecffef)
- ORT Web 1.26 source lists the output locations 'gpu-buffer', 'ml-tensor' and 'ml-tensor-cpu-output' (WebNN). — [onnxruntime-web 1.26 wasm-core-impl.ts](https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/lib/wasm/wasm-core-impl.ts). WebNN EP tutorial: [ORT WebNN EP](https://onnxruntime.ai/docs/tutorials/web/ep-webnn.html)
- ORT Web WebGPU launched with v1.17 (Feb 2024). — [Microsoft Open Source blog](https://opensource.microsoft.com/blog/2024/02/29/onnx-runtime-web-unleashes-generative-ai-in-the-browser-using-webgpu/)
- Community WebGPU-vs-WASM benchmark (transformers.js / ORT, embedding model): at batch 1, WASM 508.3 ms vs WebGPU 45.6 ms (~11x). At batch 32, 16,394.8 ms vs 503.2 ms (~33x). Speedup grows with batch size. This is a transformer, not a CNN. — [Xenova webgpu-embedding-benchmark discussions](https://huggingface.co/spaces/Xenova/webgpu-embedding-benchmark/discussions/10)
- TF.js: Chrome reports that moving a diffusion model in TF.js from WebGL to WebGPU gave "a 3x performance gain on a variety of hardware". — [Chrome blog, WebGPU I/O 2023](https://developer.chrome.com/blog/webgpu-io2023?authuser=0). Historical WebGL baseline: MobileNet v1 1.0 at 224 took 49 ms on Intel Iris Pro and 5 ms on a GTX 1080 (2019 paper). — [TensorFlow.js paper](https://arxiv.org/pdf/1901.05350)
- WASM: relaxed SIMD (Chrome 114) speeds "existing workloads from 1.5 - 3 times". On Apple M1, MediaPipe face landmark CPU and GPU inference are "comparable". — [Chrome blog, WebAssembly and WebGPU for Web AI pt.1](https://developer.chrome.com/blog/io24-webassembly-webgpu-1)
- LiteRT.js (initial release July 9, 2026, `@litertjs/core`): CPU via XNNPACK/WASM with multi-thread and relaxed SIMD, GPU via WebGPU (ML Drift), NPU via WebNN (experimental in Chrome/Edge). Up to 3x faster than other web runtimes on CPU and GPU for classical CV models. GPU/NPU 5–60x over CPU. Benchmarked on an M4 MacBook Pro. Worker support and VideoFrame input are not mentioned. — [Google Developers Blog: LiteRT.js](https://developers.googleblog.com/litertjs-googles-high-performance-web-ai-inference/). A secondary source reports the WebGPU advantage over ORT varies by model, e.g. 3.15x for EfficientNet vs 1.11x for Inception v3. — [kingy.ai LiteRT.js benchmarks](https://kingy.ai/news/litert-js-local-browser-ai-backends-benchmarks-limits/) (secondary)
- MediaPipe delegates: BaseOptions.delegate is CPU or GPU, default CPU. The docs mention WebGL and WebGPU on Web. — [MediaPipe web setup](https://ai.google.dev/mediapipe/solutions/setup_web). A third-party Oct-2026 article claims the browser GPU path is WebGL2, which conflicts with the docs and is unverified. — [forasoft article](https://www.forasoft.com/learn/ai-for-video-engineering/articles-ai/mediapipe-selfie-segmentation-webgpu-background-blur)
- Browser WebGPU support: web.dev (Nov 25, 2025) says WebGPU is supported in Chrome/Edge, Firefox 141 (Windows) and Safari 26 (macOS/iOS/iPadOS/visionOS). Firefox 141 supports "all contexts other than service workers", so dedicated workers are fine. Firefox 145 adds macOS ARM64. Linux is "in progress". — [web.dev: WebGPU supported in major browsers](https://web.dev/blog/webgpu-supported-major-browsers), [itsfoss Firefox WebGPU](https://itsfoss.com/news/firefox-webgpu-support.md)

### Inferences
- Expected speedups, an estimate rather than a measurement: tfjs 1.7 WebGL SSD-MobileNet (~50–60 ms) → ORT Web WebGPU SCRFD-2.5G at 640 with IO binding is plausibly 5–15 ms on a discrete or Apple GPU. The model is 2.5 GFLOPs, with ~4 ms native GPU in the README.
- Batching: SCRFD/YOLO ONNX exports can use a dynamic batch dimension. Feeding all tiles of a frame (or N frames) as one [N,3,640,640] tensor amortizes per-dispatch overhead. The Xenova data shows WebGPU efficiency grows strongly with batch. Graph capture requires static shapes, so fix N (pad the tile count).
- Running two different detectors (face-api + MediaPipe) doubles cost. One stronger detector at a lower threshold plus temporal tracking is likely both faster and higher-recall.
- WASM is the fallback for no-WebGPU devices (Linux Chrome, older Safari). Use multithreaded WASM (needs cross-origin isolation, COOP/COEP) with SIMD.

### Gaps
- No controlled small-CNN WebGPU vs WebGL vs WASM benchmark (e.g. ORT Web on MobileNet/SCRFD) was found with current versions. In-app measurement is needed.
- No transformers.js face-detection model or benchmark was found. transformers.js wraps ORT Web anyway.
- No data on TF.js WebGPU backend maturity in 2025–2026. TF.js development appears to have slowed in favour of LiteRT.js (not confirmed by a primary source).

## Q3. Pipeline architecture: workers, OffscreenCanvas, VideoFrame transfer, zero-copy, avoiding readbacks, WebCodecs settings, GPU downscaling

### Takeaway
Move decode, preprocessing and inference into a dedicated worker. VideoFrame is transferable, and WebGPU can consume a VideoFrame directly via importExternalTexture or copyExternalImageToTexture (shipped in Chrome). That allows a GPU-only path: decode → VideoFrame → WebGPU external texture → compute-shader resize and normalize into a storage buffer → ORT `Tensor.fromGpuBuffer` → gpu-buffer output, with only the small detection output read back. That removes canvas drawImage, getImageData and the CPU tensor upload, which are probably a significant share of the current 50–60 ms.

### Cited Findings
- Chrome "WebGPU WebCodecs integration" intent-to-ship: a VideoFrame can be the source of a GPUExternalTexture and of copyExternalImageToTexture, aimed at zero-copy sampling of YUV data. WebGPU work on frames can run in any worker, and frames can be passed between workers via postMessage. — [blink-dev Intent to Ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/QLCfazM8XLQ)
- A Chromium engineer says the design minimizes copies for drawImage, texImage and importExternalTexture, and that this "works better on some GPUs and OSs than others". — [W3C public-media-wg, Dale Curtis](https://lists.w3.org/Archives/Public/public-media-wg/2023Apr/0000.html)
- Copying a full-HD SDR frame costs ~5 ms on a high-end system if it is not in cache. Custom CPU-side processing requires a copy. — [W3C workshop talk, Paul Adenot, WebCodecs memory access](https://w3.org/2021/03/media-production-workshop/talks/paul-adenot-webcodecs-performance.html)
- WebCodecs spec: decode() can be called without awaiting previous calls. Codec work runs on a parallel queue. When saturated, calls queue up and raise decodeQueueSize, which callers should use to throttle. Codec hardware resources "MAY be quickly exhausted and SHOULD be released immediately". — [W3C WebCodecs](https://www.w3.org/TR/webcodecs/)
- Overview of frame-processing options (WebGPU/WebGL/WASM/WebNN with WebCodecs) and pipeline patterns with streams. — [webrtcHacks: video frame processing on the web](https://webrtchacks.com/video-frame-processing-on-the-web-webassembly-webgpu-webgl-webcodecs-webnn-and-webtransport/), [webrtcHacks: WebCodecs and Streams pipelines](https://webrtchacks.com/real-time-video-processing-with-webcodecs-and-streams-processing-pipelines-part-1/)
- ORT Web WebGPU accepts GPU buffers as input (`Tensor.fromGpuBuffer`) and can keep outputs on the GPU. — [ORT Web WebGPU tutorial](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html). A third-party guide notes the ORT session should be created before its WebGPU device is shared with other code. — [vgpu docs](https://vgpu.labs.vercel.dev/docs/ml/browser) (unofficial)
- MediaPipe: processing ImageBitmaps requires the task to be initialized with an OffscreenCanvas with WebGL2 support. — [MediaPipe MPImage API](https://developers.google.com/edge/api/mediapipe/js/tasks-vision.mpimage)

### Inferences
- Recommended worker pipeline: Worker A (mediabunny demux + VideoDecoder with `hardwareAcceleration: 'prefer-hardware'`) → VideoFrame → WebGPU: importExternalTexture → compute shader letterbox-resize to 640x640 (and tile crops), normalize to NCHW float16/32 storage buffer → ORT WebGPU session on the same device → small output readback (boxes and scores, a few KB) → NMS on CPU. Close each VideoFrame immediately. Without a VideoFrame→tensor GPU path, the fallback is OffscreenCanvas 2D drawImage (GPU-backed) plus getImageData at downscaled size only, never at full resolution.
- Downscale before readback. If CPU readback is unavoidable, read the 640x360 version, not 1920x1080: ~9x fewer bytes.
- Single-pass option: the app decodes twice (analysis, then blur and encode). Keeping detections per timestamp and doing blur in a WebGPU or OffscreenCanvas shader in the encode pass is already the design. Encoder settings: `hardwareAcceleration: 'prefer-hardware'`, `latencyMode: 'quality'` (default) for offline. 'realtime' trades quality for speed and is not needed offline. This is from the WebCodecs spec's general semantics and was not benchmarked.
- Detection on every frame is not needed for anonymization if tracking interpolates. Detect every 2nd–3rd frame plus tracking or IoU interpolation and box dilation. This is a 2–3x saving, used in the SCRFD browser face-swap pipeline cited in Q1.

### Gaps
- No public benchmark of importExternalTexture-in-worker → ORT WebGPU for detection was found. The expected gain is inferred.
- Safari: VideoFrame → WebGPU external texture support and WebGL-in-worker consistency are uncertain. WebKit notes WebGL in Workers works on Safari 17.1 Sonoma but not Ventura. — [WebKit bug 183720](https://bugs.webkit.org/show_bug.cgi?id=183720)

## Q4. Parallelism: multiple workers each processing a time segment

### Takeaway
It is feasible in principle. The WebCodecs spec places no limit on concurrent decoders, and each worker can own a VideoDecoder plus a model session. However, I found no published measurements of multi-worker speedup, and all workers share one GPU and one hardware decode engine. Expect gains mainly when the current bottleneck is main-thread or JS serialization rather than GPU compute. Two workers is a sensible start.

### Cited Findings
- No maximum on concurrent decoders or encoders in the spec ("implementation specific maximum ... may be any value greater than 1, including infinity"). Hardware handles "MAY be quickly exhausted". — [W3C WebCodecs](https://www.w3.org/TR/webcodecs/)
- Chrome appears to limit simultaneous audio decodes to 1, and WebKit copied this. The report concerns AudioDecoder, not video. — [WebKit bug 284448](https://bugs.webkit.org/show_bug.cgi?id=284448)
- No published reports of real multi-worker WebCodecs plus inference speedups were found (search returned only spec pages).

### Inferences
- Segmenting requires seeking to keyframes. Each segment must start at a key frame, and mediabunny supports seeking by timestamp. Detections must then be merged at segment boundaries, and tracker state restarted.
- GPU contention: N ORT WebGPU sessions on one GPU are serialized by the GPU queue. Batching tiles or frames inside one session is usually more efficient than N sessions. Use parallel workers to overlap decode, CPU NMS and tracking, and encode with GPU inference, i.e. pipeline parallelism rather than data parallelism.
- Memory: each worker loads its own model (SCRFD-10G ~16 MB fp32, YOLO-n ~6–12 MB), WASM heap and GPU buffers. Decoded 1080p frames are ~3 MB each (NV12), so bound the queued frames per worker with decodeQueueSize and backpressure.
- Size the worker pool as min(2–4, navigator.hardwareConcurrency/2). Benefit is largest for the WASM fallback path, where CPU cores are the bottleneck.

### Gaps
- No empirical data on concurrent VideoDecoder limits for hardware video decode in Chrome, or on speedup curves for N workers.

## Q5. Does MediaPipe tasks-vision support running in a Web Worker / OffscreenCanvas (2025–2026)? Known issues

### Takeaway
It works, but not cleanly. As of 0.10.22 (2025) the bundle calls `importScripts`, so module workers fail, and community solutions use a classic worker with a patched bundle. GPU delegate in a worker needs WebGL2 on OffscreenCanvas. I found no official worker sample or official statement of support.

### Cited Findings
- tasks-vision 0.10.22-rc.20250304 (blog Nov 28, 2025): the worker must be classic because the library calls `importScripts`, which fails in `{type:'module'}` workers. The author edited the bundle (removed the ES exports and mapped minified identifiers) and called it "a bit of a hack". Frames are passed as ImageBitmap via createImageBitmap(video). GPU delegate in the worker is not covered. — [How to run MediaPipe task-vision in a web worker](https://ankitskvmdam-github-io.pages.dev/blog/how-to-run-mediapipe-task-vision-in-a-web-worker)
- StackOverflow (2023): posting an HTMLVideoElement to a worker fails (not cloneable), and a module worker produces "Module scripts don't support importScripts()". — [SO: web worker with mediapipe vision](https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/76222648/how-to-use-a-web-worker-with-mediapipe-vision)
- MPImage docs: processing ImageBitmaps requires initializing the task with an OffscreenCanvas with WebGL2 support (the `canvas` option). — [MediaPipe MPImage API](https://developers.google.com/edge/api/mediapipe/js/tasks-vision.mpimage)
- Related open issues on GitHub about GPU delegate failures and web tasks. — [mediapipe #5718](https://github.com/google-ai-edge/mediapipe/issues/5718), [#6041](https://github.com/google-ai-edge/mediapipe/issues/6041), [#6216](https://github.com/google-ai-edge/mediapipe/issues/6216)
- Firefox: an older bug reported WebGPU in workers producing nothing on an OffscreenCanvas (since fixed with the Firefox 141 rollout, per Q2). — [Bugzilla 1882960](https://bugzilla.mozilla.org/show_bug.cgi?id=1882960)

### Inferences
- If MediaPipe is kept, run it in a classic worker created with `canvas: new OffscreenCanvas(1,1)` and `delegate: 'GPU'`. In theory a VideoFrame is a TexImageSource and so a valid ImageSource, but this is not confirmed by docs. Given the friction plus the 128-input recall limits, migrating to ORT Web (clean ESM, worker-friendly) or LiteRT.js is more future-proof. LiteRT.js can run the same .tflite BlazeFace models.

### Gaps
- The content of issues #5718, #6041 and #6216 was not read in detail. Whether newer tasks-vision versions (2026) fixed module-worker support is unverified.

## Q6. Is face-api.js worth replacing? @vladmandic/face-api and @vladmandic/human

### Takeaway
Yes. face-api.js is pinned to tfjs-core 1.7 (2020), and even its maintained fork says it is "completely superseded" by Human. Human offers BlazeFace-based detection with TF.js WebGL/WASM/WebGPU backends, but still uses BlazeFace-class detectors (front-camera range), so it does not solve small-face recall. A WIDER-Hard-strong ONNX model (SCRFD or YOLO-face) on ORT Web is the better replacement for this use case.

### Cited Findings
- @vladmandic/face-api: maintained but "completely superseded by the newer library Human". Supports tfjs >= 2.0 with ESM/CJS. Keeps tinyFaceDetector and ssdMobilenetv1 only. — [vladmandic/face-api docs index](https://docsearch.algolia.com/mcp/docs/repo/vladmandic/face-api)
- Human bundles CPU, WASM and WebGL backends, and WebGPU was labelled "experimental" in older READMEs. The changelog mentions WebGPU and WASM optimizations (2.8.1) and a reimplemented BlazeFace (0.8.5) without timings. The benchmark wiki was not retrievable. — [Human 3.3.6 README](https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/README.md), [Human CHANGELOG](https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/CHANGELOG.md)

### Inferences
- Dropping face-api.js also removes the second, ancient TF.js runtime (tfjs-core 1.7 WebGL), cutting bundle size and GPU context contention between two separate WebGL users (TF.js and MediaPipe).
- Suggested target stack: a single ORT Web (WebGPU EP, WASM fallback) session running SCRFD-10G or SCRFD-2.5G (or YOLOv8n/11n-face, license permitting) at 640 input with a batched tile tensor, in a worker fed by VideoFrames through a WebGPU preprocessing shader, at a low score threshold, with detection every k frames plus tracking or interpolation. Expected order of magnitude: 5–10x faster than the current 50–60 ms per inference with equal or better hard-face recall. This is an inference to verify with an in-app benchmark.

### Gaps
- No Human or face-api benchmark numbers (ms per frame per backend) were obtainable.
- Ultralytics/YOLO-face and SCRFD weight licenses: SCRFD/InsightFace pretrained models carry a non-commercial research license per the InsightFace repo (recalled, not verified here). This matters if the app is commercial. YuNet (OpenCV Zoo) is MIT-licensed (recalled, not verified). Verify before choosing.
