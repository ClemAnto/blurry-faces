import {
	Detection,
	TrackingOptions,
	buildTracks,
	computeMasks,
	iou,
	mergeDetections,
	nearestIndex,
	tileGrid,
} from './face-tracking';

const NO_PAD: TrackingOptions = {
	minIou: 0.1,
	maxCenterShift: 0.75,
	maxGap: 5,
	extendBefore: 2,
	extendAfter: 2,
	padX: 0,
	padTop: 0,
	padBottom: 0,
};

function det(x: number, y: number, size = 100, score = 0.9): Detection {
	return { x, y, width: size, height: size, score };
}

describe('face-tracking', () => {

	it('iou', () => {
		expect(iou(det(0, 0), det(0, 0))).toBe(1);
		expect(iou(det(0, 0), det(200, 0))).toBe(0);
		expect(iou(det(0, 0), det(50, 0))).toBeCloseTo(1 / 3);
	});

	it('mergeDetections elimina i duplicati e tiene il box più grande', () => {
		const merged = mergeDetections([det(0, 0, 100, 0.9), det(5, 5, 80, 0.95), det(500, 500)]);
		expect(merged.length).toBe(2);
		expect(merged[0].width).toBe(100);
		expect(merged[0].score).toBe(0.95);
	});

	it('copre un volto non rilevato in un frame quando gli altri volti sono rilevati', () => {
		// Due volti; nel frame 2 il modello trova solo il primo.
		const frames = [
			[det(0, 0), det(400, 0)],
			[det(2, 0), det(402, 0)],
			[det(4, 0)],
			[det(6, 0), det(406, 0)],
		];
		const masks = computeMasks(frames, 1000, 1000, NO_PAD);
		expect(masks[2].length).toBe(2);
		const interpolated = masks[2].find(b => b.x > 200)!;
		expect(interpolated.x).toBeCloseTo(404);
	});

	it('estende le tracce prima della prima detection e dopo l\'ultima', () => {
		const frames: Detection[][] = [[], [], [], [det(0, 0)], [], [], [], [], [], [], []];
		const masks = computeMasks(frames, 1000, 1000, NO_PAD);
		expect(masks.map(m => m.length)).toEqual([0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]);
	});

	it('non collega volti lontani e chiude le tracce dopo maxGap frame', () => {
		const tracks = buildTracks([[det(0, 0)], [det(800, 800)], [], [], [], [], [], [], [det(0, 0)]], NO_PAD);
		expect(tracks.length).toBe(3);
	});

	it('aggancia un volto in movimento rapido senza sovrapposizione', () => {
		const tracks = buildTracks([[det(0, 0)], [det(60, 0)], [det(120, 0)]], { ...NO_PAD, minIou: 0.9 });
		expect(tracks.length).toBe(1);
	});

	it('allarga i box senza limitarli al frame, così l\'ellisse resta centrata sui volti tagliati dal bordo', () => {
		const masks = computeMasks([[det(100, 100, 100)]], 1000, 1000, { ...NO_PAD, padX: 0.25, padTop: 0.5, padBottom: 0.2 });
		expect(masks[0][0]).toEqual({ x: 75, y: 50, width: 150, height: 170 });
	});

	it('allunga verso l\'esterno i box che toccano il bordo (volti tagliati)', () => {
		const masks = computeMasks([[det(0, 400, 100), det(400, 400, 100)]], 1000, 1000, NO_PAD);
		expect(masks[0][0]).toEqual({ x: -30, y: 400, width: 130, height: 100 });
		expect(masks[0][1]).toEqual({ x: 400, y: 400, width: 100, height: 100 });
	});

	it('scarta solo i box interamente fuori dal frame', () => {
		const masks = computeMasks([[det(-150, 400, 100), det(850, 400, 100)]], 1000, 1000, NO_PAD);
		expect(masks[0]).toEqual([{ x: 850, y: 400, width: 100, height: 100 }]);
	});

	it('tileGrid', () => {
		expect(tileGrid(640, 480)).toEqual([]);
		const tiles = tileGrid(1920, 1080);
		expect(tiles.length).toBe(4);
		expect(Math.max(...tiles.map(t => t.x + t.width))).toBe(1920);
		expect(Math.max(...tiles.map(t => t.y + t.height))).toBe(1080);
	});

	it('nearestIndex', () => {
		const ts = [0, 0.04, 0.08, 0.12];
		expect(nearestIndex(ts, 0.05)).toBe(1);
		expect(nearestIndex(ts, 0.07)).toBe(2);
		expect(nearestIndex(ts, 5)).toBe(3);
		expect(nearestIndex([], 1)).toBe(-1);
	});
});
