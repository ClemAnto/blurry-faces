# Temporal strategies to cut face-detector calls in video anonymization (recall first)

Scope: offline, in-browser (JS/WASM/WebGL/WebGPU) blurring of faces in phone videos (15 s to 4 min, 480p to 4K, 24 to 60 fps). Current app: two detectors (face-api SSD MobileNet v1 + MediaPipe BlazeFace full-range) on every frame, tiles above 960 px, IoU tracking, linear gap interpolation up to 1 s, ±0.5 s track extension. Measured results are labelled "measured"; vendor/author statements without a benchmark are labelled "claim".

## 1. Sparse / keyframe detection every N frames plus tracking in between

### Takeaway
Detecting every N frames (N ≈ 5 to 10 in the literature) and propagating boxes in between gives roughly 3 to 5× fewer detector calls. On generic benchmarks the cost is about 1 to 2 mAP points, but those benchmarks don't measure the worst case for redaction: a face that first appears between keyframes, or one the tracker loses. Adaptive triggers driven by tracker confidence beat a fixed N at the same speed. A plain Kalman/IoU tracker (SORT, OC-SORT, ByteTrack-style association) is nearly free in JS. Correlation trackers (KCF/CSRT) are not usable from stock OpenCV.js.

### Cited Findings
- **Sparse keyframes, "Towards High Performance Video Object Detection" (Zhu et al., CVPR 2018). Measured on ImageNet VID with R-FCN ResNet-101.** The keyframe interval l was varied from 1 to 10, and l = 10 gave the best speed/accuracy trade-off. Their variants gain about +1% mAP at 3× speedup, +1.4% mAP at 4×, and about +1% at 4.75× (relative to their own dense baselines). Final results: 78.6% mAP at 13.0 fps, or 77.8% at 22.9 fps on a Titan X. — [ar5iv 1711.11577](https://ar5iv.labs.arxiv.org/html/1711.11577)
- The same paper's adaptive keyframe rule: a frame becomes a keyframe when the fraction of locations where feature propagation is unreliable (predicted quality Q ≤ τ, with τ = 0) exceeds γ = 0.2. An oracle keyframe policy reaches 80.9% mAP at 22.8 fps (upper bound). — [ar5iv 1711.11577](https://ar5iv.labs.arxiv.org/html/1711.11577)
- **Search-snippet summary, not checked in the full text.** Varying l from 1 to 10 gives about a 5× speedup with an accuracy loss within about 1%, and recursive aggregation reaches about 10× speedup for about a 2% loss. — [arXiv 1711.11577](https://arxiv.org/pdf/1711.11577)
- **"Detect or Track" (DorT; Luo et al., AAAI 2019). Measured on ImageNet VID.**
  - Fixed-interval detect-every-σ-frames is treated as the standard baseline. The paper argues a fixed interval is suboptimal because detection frequency should depend on tracking quality.
  - Setup: R-FCN detector at 8.33 fps, SiamFC tracker/scheduler at 100 fps, Hungarian association at 667 fps.
  - A learned scheduler decides detect vs. track per frame. It is set conservative, outputting "track" only when the confidence of "track" exceeds δ = 0.97, because "mAP drops drastically if the scheduler mistakenly predicts track". Its false "track" rate is 1.9% at σ = 10.
  - Their framework runs at 54 fps with σ = 10, with no more than 1% mAP loss versus deep feature flow at much higher speed.
  - Associating boxes with the Hungarian algorithm on every frame is "generally less reliable" than tracking between frames, so mAP vs. frame rate is non-monotonic.
  — [Microsoft Research PDF](https://www.microsoft.com/en-us/research/uploads/prod/2019/02/AAAI-LuoH.pdf); [arXiv 1811.05340](https://arxiv.org/abs/1811.05340)
- **Confidence-Triggered Detection (CTD, arXiv 1902.00615). Measured on MOTChallenge with a DeepSORT tracker.**
  - Detection is triggered when the Kalman-prediction confidence (Mahalanobis distance mapped through chi-square with 4 degrees of freedom) falls below a threshold, or when a maximum skip count is reached. The maximum skip was varied from 1 to 10; Table II uses 8.
  - At a 90% confidence threshold: +29% speed for −2.1 to −3.0% accuracy, depending on the detector (YOLOv3-Tiny, MobileNet-SSD, SqueezeNet).
  - At a 10% threshold: about +145% speed for −26 to −28% accuracy.
  - A 0% threshold equals fixed-interval skipping. CTD beats fixed skipping at equal speed (qualitative figure only).
  - CTD at a 30% threshold runs at 21.4 Hz with MOTA 19.5, versus 8.1 Hz and MOTA 22.2 for an every-frame tracker. This comparison isn't controlled, because the methods use different trackers.
  — [arXiv 1902.00615v6](https://arxiv.org/html/1902.00615v6)
- **Detect-to-Track (Feichtenhofer et al., ICCV 2017).** Evaluating only every τ-th frame, frame-level accuracy is reported as fairly insensitive to the stride (search snippet). — [PDF](https://feichtenhofer.github.io/pubs/DT_iccv17.pdf)
- **ByteTrack (Zhang et al., ECCV 2022).** It associates almost every detection box, including low-score boxes (often occluded objects), instead of discarding them below a threshold. Discarding them causes "missed objects and fragmented trajectories". Adding the association to 9 trackers improves IDF1 by about 1 to 10 points. MOT17 test: 80.3 MOTA, 77.3 IDF1, 30 fps on a V100 including the detector. — [arXiv 2110.06864](https://arxiv.org/abs/2110.06864)
- **OC-SORT (Cao et al., CVPR 2023).** Kalman filter plus "observation-centric re-update": after an occlusion, it rebuilds a virtual trajectory from observations to correct the accumulated filter drift. Claimed robust to occlusion and non-linear motion (DanceTrack), and 700+ FPS on one CPU given detections. — [arXiv 2203.14360](https://arxiv.org/abs/2203.14360)
- **OpenCV.js trackers.**
  - The standard opencv.js build doesn't expose the tracking module (KCF, CSRT, MOSSE, etc.). Users must rebuild with `-DBUILD_opencv_tracking=ON` plus config and whitelist edits.
  - Reported failures: `cv.TrackerKCF_create is not a function`, `UnboundTypeError: Cannot construct TrackerKCF due to unbound types`, and a broken `update()` even when construction works.
  — [OpenCV forum: virtual class](https://forum.opencv.org/t/cannot-load-virtual-class-tracking-algorithm-in-compiled-opencv-js/6093); [unbound types](https://forum.opencv.org/t/cannot-construct-trackerkcf-and-trackercsrt-due-to-unbound-types/10949); [update fails](https://forum.opencv.org/t/opencv-js-cannot-use-the-trackerkcf-update-function/18959); [contrib build error](https://forum.opencv.org/t/opencv-js-build-tracking-module-in-opencv-contrib-but-encounter-generate-error/608)
- **Optical flow in JS.**
  - OpenCV.js has an official Lucas-Kanade tutorial page (calcOpticalFlowPyrLK). The page returned HTTP 403 to my fetch, so I could not check its contents.
  - jsfeat implements pyramidal Lucas-Kanade, FAST and ORB in pure JS. The only performance statement is a 2012 qualitative "realtime from a webcam"; no current benchmarks were found.
  — [OpenCV.js LK tutorial](https://docs.opencv.org/4.x/db/d7f/tutorial_js_lucas_kanade.html); [jsfeat repo](https://github.com/Carnaux/jsfeat); [I Programmer review](https://www.i-programmer.info/news/105-artificial-intelligence/5127-jsfeat-javascript-image-processing-library.html)
- **A patent on asynchronous detection updates (search snippet).** It describes detection every k frames with a lightweight tracker in between, discounting tracker confidence over time to account for drift. — [USPTO](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12361681)

### Inferences
- For this app, a realistic N is 3 to 10 frames at 30 fps (0.1 to 0.33 s). The ±0.5 s track extension and the 1 s gap interpolation already absorb a lot of the risk of sparse detection. Faces that appear and vanish entirely between keyframes are the residual risk, and it is small when N/fps is far below 0.5 s.
- Recall risk comes mostly from faces that appear between keyframes, which the tracker can't create, and from tracker drift on fast motion. An adaptive N driven by Kalman innovation (CTD) or by a motion score is preferable to a fixed N.
- The cheapest tracker in JS is a Kalman/IoU tracker like the current one. ByteTrack's idea maps directly onto the app: keep low-score detections (for example 0.1 to 0.2) for associating with existing tracks, while starting new tracks only at a higher score. This boosts recall on tilted-down and profile heads at little false-positive cost.
- KCF/CSRT in the browser would need a custom OpenCV.js build, with reported binding bugs. Pyramidal LK on a handful of corners inside each face box (opencv.js core or jsfeat) is the practical "between keyframes" propagator.

### Gaps
- I found no published measurements of KCF, CSRT, MOSSE or LK speed in the browser (WASM or JS) at 720p to 4K.
- None of the cited acceleration papers report recall/FN specifically; they report mAP or MOTA. The miss rate for objects appearing between keyframes isn't quantified anywhere I found.

## 2. Adaptive sampling: motion, scene cuts, static segments, coarse-to-fine temporal search

### Takeaway
Scene-cut detection is cheap and well understood (PySceneDetect's HSV content difference, histogram, perceptual hash). At minimum it should force a detection right after every cut and stop tracks or interpolation from crossing cuts. Motion- or confidence-triggered detection is supported by DorT and CTD. I found no redaction-specific evaluation of coarse-to-fine temporal search (scan sparsely, then densify where faces appear or disappear), so its recall effect is unmeasured.

### Cited Findings
- **PySceneDetect detectors (documented defaults):**
  - ContentDetector: weighted average of pixel changes in HSV between adjacent frames; threshold 27.
  - AdaptiveDetector: content score compared with a rolling average; adaptive_threshold 3.0, min_content_val 15, window 2. Designed to reduce false cuts during fast camera motion.
  - HistogramDetector: Y-channel histograms; threshold 0.2, 128 bins.
  - HashDetector: DCT perceptual hash with Hamming distance; threshold 0.35, size 8.
  - ThresholdDetector: fades.
  - Default min_scene_len is 15 frames.
  — [PySceneDetect detectors API](https://www.scenedetect.com/docs/latest/api/detectors.html)
- **DorT's scheduler** learns to switch to detection when objects move a lot or appear and disappear. Its training labels mark "detect" when any tracked box's IoU with ground truth drops below a threshold, or when objects emerge or disappear. — [Microsoft Research PDF](https://www.microsoft.com/en-us/research/uploads/prod/2019/02/AAAI-LuoH.pdf)
- **CTD** triggers detection on low tracker confidence, with a hard maximum-skip cap (1 to 10 frames tested). — [arXiv 1902.00615v6](https://arxiv.org/html/1902.00615v6)
- **Zhu et al.'s adaptive keyframe rule** (fraction of unreliable flow locations > 0.2) is a motion/novelty trigger in feature space. — [ar5iv 1711.11577](https://ar5iv.labs.arxiv.org/html/1711.11577)
- **Amped Software (claim/advice):** run detection only on the relevant portion of the clip when possible (a manual temporal ROI). — [Amped blog, Jan 2026](https://blog.ampedsoftware.com/2026/01/21/redacting-faces-people-vehicles-and-plates-with-amped-replay-assisted-redaction)

### Inferences
- PySceneDetect's math (HSV mean absolute difference, luma histogram, 8×8 DCT hash) is trivial to reimplement on a 64 to 160 px downscaled frame in JS or WebGL. The cost is negligible next to a detector call.
- A safe adaptive scheme for recall:
  - Always detect on frame 0, on each cut, and at a maximum interval Nmax.
  - Detect sooner when the frame-difference energy or the Kalman innovation is high.
  - Never let interpolation or track extension cross a cut.
- For phone videos (handheld, continuous motion), "skip static segments" saves little. "Skip segments with no faces" is risky because a missed small background face is exactly the failure mode already observed. A "no face" verdict should be confirmed by the full-quality detector (with tiles), not by a cheap pass.
- Coarse-to-fine temporal search is a natural offline fit:
  - Pass 1: full detection every k frames.
  - Pass 2: densify between keyframes whose face sets differ (a track appears or ends, or the count changes). Bisection there localizes start and end frames in about log2(k) extra calls per event.
  - Keep the ±0.5 s safety extension on top.
  This is untested in the literature I found.

### Gaps
- I found no measurements of how often faces are missed by scene-adaptive or binary-search sampling in redaction workloads.
- I found no benchmark of frame-difference gating on handheld phone footage.

## 3. Detection cascades and ROI-only re-detection

### Takeaway
Cascades plus tracker-predicted ROIs are a proven way to cut compute 5 to 13× on driving and pedestrian data with a small mAP loss (CaTDet). MediaPipe's own face pipeline is the canonical browser example: it derives the next frame's ROI from the current landmarks and calls the detector only when tracking is lost. For recall, a cheap whole-frame pass can't be the only gate for new faces, especially small or background ones.

### Cited Findings
- **CaTDet (MLSys 2019). Measured.** Two-DNN cascade plus a tracker that predicts regions of interest from past detections. KITTI: 5.1 to 8.7× fewer operations at the same mAP as single-model Faster R-CNN, with about 0.3 frames of extra delay. CityPersons: 13.0× fewer operations for a 0.8% mAP loss. — [arXiv 1810.00434](https://arxiv.org/abs/1810.00434); [MLSys PDF](https://mlsys.org/Conferences/2019/doc/2019/111.pdf)
- **MediaPipe Face Mesh (legacy docs).** Crops for the landmark model are derived from the previous frame's landmarks. The face detector is invoked "only when the landmark model could no longer identify face presence"; it "simply tracks those landmarks without invoking another detection until it loses track". — [MediaPipe face_mesh docs](https://mediapipe.readthedocs.io/en/latest/solutions/face_mesh.html); [GitHub docs](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/face_mesh.md)
- **The pub.dev `mediapipe_face_mesh` package** has a tracking mode that runs the detector only to acquire or re-acquire faces, and `enableLandmarkTracking: false` to force detection every frame. — [pub.dev](https://pub.dev/documentation/mediapipe_face_mesh/2.0.0/)
- **The current MediaPipe Face Landmarker task:**
  - Documents VIDEO mode as "synchronous tracking across decoded video frames" and exposes minFaceDetectionConfidence, minFacePresenceConfidence and minTrackingConfidence.
  - Its detector is BlazeFace short-range.
  - It does not document when re-detection happens. Treat the "skip the detector" behavior as plausible, not confirmed, for this task API.
  — [Face Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker)
- **Resolution and recall, measured in a face-anonymization pipeline (Smart City intersections, YOLOv4, 4K video).**
  - Face recall at visible size: 0.837 at 608², 0.939 at 960², 0.989 at 1440² input.
  - Manual evaluation: 98.24% at 960² vs. 98.61% at 1440².
  - The median face area in the dataset is 198 px; small faces drive the need for large inputs.
  — [NSF PAR, Real-Time Video Anonymization in Smart City Intersections](https://par.nsf.gov/servlets/purl/10405514)
- **Crop-based detection combined with frame skipping** reportedly gives a 149% frame-rate increase over KIOU with no accuracy loss (search snippet, not verified in full text). — [OSTI 1842767](https://www.osti.gov/servlets/purl/1842767)
- **deface** downscales only for detection (`--scale WxH`), then maps boxes back to the original resolution. It warns that inputs well above 720p hurt performance, and very high resolutions can hurt accuracy. — [ORB-HD/deface](https://github.com/ORB-HD/deface)

### Inferences
- A JS-practical cascade:
  1. A low-resolution whole frame (BlazeFace at 128/256 px input, or SSD at about 512 px) on every keyframe.
  2. Tracked faces re-detected via a crop around the Kalman-predicted box (enlarged 1.5 to 2×) at native resolution on in-between frames. This is cheap because the crops are small, and better for small faces than tiling the whole frame.
  3. Full tiling of the frame only on keyframes at a lower rate (for example every 0.5 to 1 s), plus after cuts, to discover new small background faces.

  Keyframe tiling is what protects recall for "small background faces". ROI crops protect existing tracks through fast motion and head tilt.
- The Smart City numbers show resolution is a first-order recall factor for small faces (0.84 → 0.99). Cutting tiles everywhere to save time would likely cost more recall than temporal sparsity. Tile less often rather than never.

### Gaps
- I found no measured face-specific results for ROI re-detection vs. full-frame detection in recall terms.
- I found no browser benchmark of BlazeFace on crops vs. full frames at 4K.

## 4. Bidirectional (forward + backward) tracking for offline processing

### Takeaway
Offline processing allows backward propagation: tracks can be extended before their first detection and after their last. Practical redaction pipelines do this crudely with fixed temporal dilation and gap interpolation, which the app already does (±0.5 s, 1 s gaps). I found no paper quantifying forward-backward tracking recall gains for face redaction.

### Cited Findings
- **ld-wg "lose-the-faces-keep-the-lesson" (open-source redaction pipeline, PR #11, measured on one demo video).**
  - Tracks are emitted from their first detection; the earlier min_hits = 3 had hidden the first 2 frames of each track.
  - Gaps of up to 30 frames inside a track are interpolated, and confirmed tracks are dilated by 3 frames at each end.
  - The detector threshold was lowered to 0.1 for ByteTrack's low-confidence association, while new tracks still start at 0.5 or above.
  - "Fail-closed": any face box without a generated replacement is covered by a gray ellipse.
  - Result: face boxes went from 4726 to 6864 and frame coverage from 0.453 to 1.000.
  - Newly covered faces were "harder (low confidence, bowed, small)".
  — [GitHub PR #11](https://github.com/ld-wg/lose-the-faces-keep-the-lesson/pull/11)
- **ahmeddoghri/videoprivacy (author claim, simulated data).** Gap-filling gives a ~27 to 30 point coverage gain over naive per-frame detection, across 2,100 randomized simulated frames. — [GitHub](https://github.com/ahmeddoghri/videoprivacy)
- **A face-blurring patent** uses linear interpolation of face position and size between frames. When detection fails, the tracking filter may assume the face stayed in place with the same size. — [USPTO 12688559](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12688559)
- **Live-stream face pixelation paper (arXiv 2101.01060, search snippet).** A high-recall proposal network finds detections in gap frames, gaps are patched, and trajectories are smoothed by interpolation. — [arXiv 2101.01060](https://arxiv.org/pdf/2101.01060)
- **A UCLA IROS paper on multi-frame masking (search snippet; full text unavailable, certificate error).** It states that tracking improves latency but reduces recall, and proposes fusing evidence from adjacent frames to recover missed faces. — [UCLA PDF](https://ssysarch.ee.ucla.edu/files/26_MultiframeMasking_IROS.pdf)

### Inferences
- With sparse keyframes, bidirectional propagation matters more: a face whose first detection is at keyframe k may already be visible a few frames earlier.
- The practical recipe:
  1. Run a backward LK/ROI pass from the first detection of each track until the ROI detector fails, or for at most N frames.
  2. Run the same forward pass after the last detection.
  3. Keep a fixed safety dilation on top.
- Because the app decodes frames sequentially with WebCodecs, backward propagation needs either cached frames (memory-heavy at 4K) or a second decode of short windows. Alternatively, use the existing ±0.5 s dilation as the cheap substitute and rely on N/fps << 0.5 s.

### Gaps
- I found no quantitative evaluation of forward-backward tracking vs. fixed dilation for redaction recall.
- I couldn't access the full text of the UCLA IROS paper or arXiv 2101.01060 (fetch errors), so their numbers are unknown.

## 5. What existing anonymization tools and vendors do, and quantitative recall trade-offs where misses are costly

### Takeaway
Open-source deface detects on every frame independently with no tracking, compensating with a low threshold (0.2) and enlarged masks (×1.3). Commercial redaction tools (Veritone, Amped, Axon) combine detection, tracking and interpolation with mandatory human review. None of the vendors I found publish recall numbers. The few published redaction recall figures (about 98 to 99% for visible faces) come from per-frame detection at high input resolution. Privacy work consistently sets thresholds very low to favor recall.

### Cited Findings
- **deface (ORB-HD):**
  - CenterFace, analyzing "each video frame independently"; no tracking or temporal smoothing is described.
  - `--thresh` defaults to 0.2. At 0.02 there are false positives on hands; at 0.7 there are misses on partially occluded faces.
  - `--mask-scale` defaults to 1.3 "to make sure that masks cover the complete face".
  - `--scale` downsamples detection input only. Backends: ONNX Runtime or OpenCV.
  — [ORB-HD/deface](https://github.com/ORB-HD/deface)
- **Veritone Redact (vendor claim):** automatic detection and object tracking across frames. The engine scans "frame by frame" for heads, persons and plates. It uses head detection, which does not rely on visible facial features, and users review detection lists before redacting. No recall figures are published. — [Veritone video redaction blog](https://www.veritone.com/blog/video-redaction/); [Veritone redaction](https://veritone.com/solutions/redaction)
- **Amped Replay Assisted Redaction (vendor docs, Jan 2026):**
  - Detects persons, heads, vehicles and plates, and tracks each detection.
  - If the detector misses frames, it interpolates between keyframes when the boxes belong to the same object.
  - Tracks may split on angle or occlusion changes and can be merged.
  - Recommends an ellipse that circumscribes the box (larger coverage) and mandatory full playback review, because redactions can drop out when a person partially leaves the frame or changes appearance.
  - No recall numbers.
  — [Amped blog](https://blog.ampedsoftware.com/2026/01/21/redacting-faces-people-vehicles-and-plates-with-amped-replay-assisted-redaction)
- **Axon Redaction Assistant (vendor listing):** bulk initiation, view all unique faces and pick which to redact. No technical description of keyframes or interpolation was found. — [Officer.com product page](https://www.officer.com/command-hq/technology/computers-software/investigation-software/product/21082740/axon-axon-redaction-assistant); [Police Magazine](https://www.policemag.com/news/axon-launches-first-advanced-ai-powered-redaction-tool)
- **CVAT (annotation, not redaction).** Track mode interpolates shapes between user keyframes; a third-party mirror says this is linear by default. Trackers such as TransT and SAM 2 Tracker propagate a box for a set number of frames. — [CVAT track mode](https://docs.cvat.ai/docs/annotation/manual-annotation/modes/track-mode-basics/); [CVAT AI tools](https://docs.cvat.ai/docs/annotation/auto-annotation/ai-tools/); [CVAT SAM 2 blog](https://www.cvat.ai/blog/video-annotation-sam-2)
- **Smart City anonymization (peer-reviewed, measured):**
  - Recall is chosen as "the metric most indicative" for privacy-critical use.
  - Confidence threshold 0.0125 and NMS 0.4 "to maximize anonymization recall".
  - "Missed" means more than half the object is left non-anonymized.
  - Face recall for visible faces (≥ 250 px area): 98.9% programmatic at 1440², and 98.24 / 98.61% manual at 960² / 1440² over 8 videos of about 5,300 frames each.
  - Persistent failures: superimposed faces, partial occlusion, frame-edge cases.
  - All of this is per-frame detection at 61 FPS on an A100, with no tracking.
  — [NSF PAR 10405514](https://par.nsf.gov/servlets/purl/10405514)
- **AssassinPunk/tracked-face-redaction (hobby project, measured on 24 faces).**
  - Raising the confidence threshold from 0.6 to 0.9 dropped 37.5% of real faces with no speed gain.
  - Blur never made all faces undetectable; pixelation at 0.25 did.
  - Its detect-every-N tracking (Norfair) speed/recall benchmark is roadmap-only, not yet measured.
  — [GitHub](https://github.com/AssassinPunk/tracked-face-redaction)
- **ld-wg PR #11** (see section 4): a recall post-pass plus low-threshold ByteTrack association raised coverage from 0.453 to 1.000 on a demo video. — [GitHub PR #11](https://github.com/ld-wg/lose-the-faces-keep-the-lesson/pull/11)
- **DorT** biases its scheduler toward "detect" (δ = 0.97) because wrong "track" decisions are costly. This is the same asymmetry redaction needs. — [Microsoft Research PDF](https://www.microsoft.com/en-us/research/uploads/prod/2019/02/AAAI-LuoH.pdf)

### Inferences
- The consistent recommendations across sources:
  - A very low detection threshold, with tracks needing confirmation or association to suppress false positives.
  - Over-cover: mask scale about 1.3 or a circumscribed ellipse, plus temporal dilation.
  - Head or person detection as a fallback for faces whose features aren't visible. This is relevant to the observed misses on heads tilted down and profiles.
  - A human review step with a timeline of coverage.
- No source gives a recall-vs-N curve for face redaction. The safest speedup for this app is likely:
  1. Keep the full detector stack (both models plus tiles) on keyframes every about 0.2 to 0.33 s, and on every scene cut.
  2. On in-between frames, run one cheap ROI detector on crops around predicted tracks.
  3. Escalate to full detection when the motion score or Kalman innovation spikes, or when a track's ROI detection fails.
  4. Keep the existing interpolation and ±0.5 s dilation.

  Expected detector-call reduction is about 3 to 6× for the heavy stack, by analogy with the 3 to 5× in the VID papers and the 5 to 13× ops reduction in CaTDet. Recall risk is concentrated in faces that appear briefly between keyframes, and that window is bounded by N/fps.
- Note that the app's ±0.5 s extension already exceeds what ld-wg uses (3 frames).

### Gaps
- No vendor (Brighter AI, Veritone, Axon, Amped) publishes recall or miss-rate figures or its frame-sampling strategy. Searches for Brighter AI internals were not performed or turned up nothing usable.
- I found no peer-reviewed benchmark measuring face-redaction recall as a function of detection stride N.
