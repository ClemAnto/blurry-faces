/**
 * Logica pura (senza DOM) per trasformare le detection grezze, frame per frame,
 * nelle aree da oscurare: unione dei risultati multi-scala, tracking dei volti
 * nel tempo, interpolazione dei buchi, estensione prima/dopo e padding.
 */

export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface Detection extends Box {
	score: number;
}

export interface TrackingOptions {
	/** Sovrapposizione minima (IoU) per considerare due box lo stesso volto. */
	minIou: number;
	/** Distanza massima tra i centri, in multipli della dimensione del box, per agganciare un volto in movimento rapido. */
	maxCenterShift: number;
	/** Frame consecutivi senza detection oltre i quali una traccia si chiude. I buchi più corti vengono interpolati. */
	maxGap: number;
	/** Frame oscurati prima della prima detection di una traccia. */
	extendBefore: number;
	/** Frame oscurati dopo l'ultima detection di una traccia. */
	extendAfter: number;
	/** Allargamento orizzontale per lato, in frazione della larghezza. */
	padX: number;
	/** Allargamento verso l'alto (fronte, capelli), in frazione dell'altezza. */
	padTop: number;
	/** Allargamento verso il basso (mento), in frazione dell'altezza. */
	padBottom: number;
}

export function defaultTrackingOptions(fps: number): TrackingOptions {
	return {
		minIou: 0.1,
		maxCenterShift: 0.75,
		maxGap: Math.max(1, Math.round(fps * 1.0)),
		extendBefore: Math.max(1, Math.round(fps * 0.5)),
		extendAfter: Math.max(1, Math.round(fps * 0.5)),
		padX: 0.25,
		padTop: 0.45,
		padBottom: 0.2,
	};
}

export function iou(a: Box, b: Box): number {
	const inter = intersection(a, b);
	const union = a.width * a.height + b.width * b.height - inter;
	return union > 0 ? inter / union : 0;
}

/** Intersezione rispetto all'area del box più piccolo: rileva un volto tagliato contenuto in uno intero. */
export function overlapOfSmaller(a: Box, b: Box): number {
	const minArea = Math.min(a.width * a.height, b.width * b.height);
	return minArea > 0 ? intersection(a, b) / minArea : 0;
}

function intersection(a: Box, b: Box): number {
	const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
	const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
	return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Unisce detection provenienti da passate diverse (frame intero + tile) eliminando i duplicati.
 * In caso di sovrapposizione tiene il box più grande, che copre anche le parti del volto tagliate da un tile.
 */
export function mergeDetections(detections: Detection[], threshold = 0.5): Detection[] {
	const sorted = [...detections].sort((a, b) => b.width * b.height - a.width * a.height);
	const kept: Detection[] = [];
	for (const det of sorted) {
		const dup = kept.find(k => iou(k, det) > threshold || overlapOfSmaller(k, det) > 0.7);
		if (dup) {
			dup.score = Math.max(dup.score, det.score);
		} else {
			kept.push({ ...det });
		}
	}
	return kept;
}

interface Track {
	/** Frame in cui il volto è stato rilevato, in ordine crescente, con il relativo box. */
	frames: number[];
	boxes: Box[];
}

function centerShift(a: Box, b: Box): number {
	const dx = (a.x + a.width / 2) - (b.x + b.width / 2);
	const dy = (a.y + a.height / 2) - (b.y + b.height / 2);
	const size = Math.max(a.width, a.height, b.width, b.height);
	return size > 0 ? Math.hypot(dx, dy) / size : Infinity;
}

/** Collega le detection di frame consecutivi in tracce, una per volto. */
export function buildTracks(frames: Detection[][], opts: TrackingOptions): Track[] {
	const tracks: Track[] = [];
	let active: Track[] = [];

	frames.forEach((detections, f) => {
		active = active.filter(t => f - t.frames[t.frames.length - 1] <= opts.maxGap);

		// Abbinamento greedy: prima le coppie più simili.
		const pairs: { t: Track; d: number; cost: number }[] = [];
		active.forEach(t => {
			const last = t.boxes[t.boxes.length - 1];
			detections.forEach((det, d) => {
				const overlap = iou(last, det);
				const shift = centerShift(last, det);
				if (overlap >= opts.minIou || shift <= opts.maxCenterShift) {
					pairs.push({ t, d, cost: overlap > 0 ? 1 - overlap : 1 + shift });
				}
			});
		});
		pairs.sort((a, b) => a.cost - b.cost);

		const usedTracks = new Set<Track>();
		const usedDets = new Set<number>();
		for (const p of pairs) {
			if (usedTracks.has(p.t) || usedDets.has(p.d)) continue;
			usedTracks.add(p.t);
			usedDets.add(p.d);
			p.t.frames.push(f);
			p.t.boxes.push(toBox(detections[p.d]));
		}

		detections.forEach((det, d) => {
			if (usedDets.has(d)) return;
			const track: Track = { frames: [f], boxes: [toBox(det)] };
			tracks.push(track);
			active.push(track);
		});
	});

	return tracks;
}

function toBox(b: Box): Box {
	return { x: b.x, y: b.y, width: b.width, height: b.height };
}

function lerpBox(a: Box, b: Box, t: number): Box {
	return {
		x: a.x + (b.x - a.x) * t,
		y: a.y + (b.y - a.y) * t,
		width: a.width + (b.width - a.width) * t,
		height: a.height + (b.height - a.height) * t,
	};
}

export function padBox(b: Box, opts: TrackingOptions, frameWidth: number, frameHeight: number): Box {
	const x1 = Math.max(0, b.x - b.width * opts.padX);
	const y1 = Math.max(0, b.y - b.height * opts.padTop);
	const x2 = Math.min(frameWidth, b.x + b.width * (1 + opts.padX));
	const y2 = Math.min(frameHeight, b.y + b.height * (1 + opts.padBottom));
	return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
}

/**
 * Calcola, per ogni frame, le aree da oscurare: ogni traccia copre i frame tra la prima e l'ultima detection
 * (interpolando i buchi), più `extendBefore`/`extendAfter` frame ai lati. I box sono già allargati e limitati al frame.
 */
export function computeMasks(
	frames: Detection[][],
	frameWidth: number,
	frameHeight: number,
	opts: TrackingOptions,
): Box[][] {
	const masks: Box[][] = frames.map((): Box[] => []);
	const last = frames.length - 1;

	for (const track of buildTracks(frames, opts)) {
		const first = track.frames[0];
		const end = track.frames[track.frames.length - 1];

		for (let f = Math.max(0, first - opts.extendBefore); f < first; f++) {
			masks[f].push(track.boxes[0]);
		}
		for (let i = 0; i < track.frames.length; i++) {
			const f = track.frames[i];
			masks[f].push(track.boxes[i]);
			const next = track.frames[i + 1];
			if (next === undefined) continue;
			for (let g = f + 1; g < next; g++) {
				masks[g].push(lerpBox(track.boxes[i], track.boxes[i + 1], (g - f) / (next - f)));
			}
		}
		for (let f = end + 1; f <= Math.min(last, end + opts.extendAfter); f++) {
			masks[f].push(track.boxes[track.boxes.length - 1]);
		}
	}

	return masks.map(boxes => boxes
		.map(b => padBox(b, opts, frameWidth, frameHeight))
		.filter(b => b.width > 0 && b.height > 0));
}

/**
 * Griglia di tile sovrapposti per rilevare volti piccoli: il detector ridimensiona l'input a ~512 px,
 * quindi su un frame grande un volto lontano diventa di pochi pixel. Restituisce [] se il frame è già piccolo.
 */
export function tileGrid(width: number, height: number, tileSize = 960, overlap = 0.2): Box[] {
	const cols = Math.ceil(width / tileSize);
	const rows = Math.ceil(height / tileSize);
	if (cols * rows <= 1) return [];

	const tw = Math.min(width, (width / cols) * (1 + overlap));
	const th = Math.min(height, (height / rows) * (1 + overlap));
	const tiles: Box[] = [];
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			const x = cols === 1 ? 0 : (c * (width - tw)) / (cols - 1);
			const y = rows === 1 ? 0 : (r * (height - th)) / (rows - 1);
			tiles.push({ x: Math.round(x), y: Math.round(y), width: Math.round(tw), height: Math.round(th) });
		}
	}
	return tiles;
}

/** Indice del timestamp più vicino in un array ordinato. */
export function nearestIndex(sorted: number[], value: number): number {
	let lo = 0;
	let hi = sorted.length - 1;
	if (hi < 0) return -1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (sorted[mid] < value) lo = mid + 1;
		else hi = mid;
	}
	if (lo > 0 && Math.abs(sorted[lo - 1] - value) <= Math.abs(sorted[lo] - value)) return lo - 1;
	return lo;
}
