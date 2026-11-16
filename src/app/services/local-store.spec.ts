import { APP_VERSION, MAX_AGE_MS, compareVersions, isValidStamp, stamp } from './local-store';

describe('local-store', () => {

	it('compareVersions', () => {
		expect(compareVersions('1.1.0', '1.1.0')).toBe(0);
		expect(compareVersions('1.0.9', '1.1.0')).toBeLessThan(0);
		expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
		expect(compareVersions('2', '1.9.9')).toBeGreaterThan(0);
	});

	it('accetta un dato appena scritto dalla versione corrente', () => {
		const s = stamp({ a: 1 }, 1_000_000);
		expect(s.appVersion).toBe(APP_VERSION);
		expect(isValidStamp(s, 1_000_000 + 1000)).toBeTrue();
	});

	it('scarta dati troppo vecchi', () => {
		const s = stamp({ a: 1 }, 0);
		expect(isValidStamp(s, MAX_AGE_MS + 1)).toBeFalse();
	});

	it('scarta dati di versioni incompatibili o future', () => {
		expect(isValidStamp({ appVersion: '1.0.0', savedAt: 0, data: {} }, 0)).toBeFalse();
		expect(isValidStamp({ appVersion: '99.0.0', savedAt: 0, data: {} }, 0)).toBeFalse();
	});

	it('scarta valori non timbrati o malformati', () => {
		expect(isValidStamp(null)).toBeFalse();
		expect(isValidStamp({ data: {} })).toBeFalse();
		expect(isValidStamp({ appVersion: APP_VERSION, savedAt: 'ieri', data: {} })).toBeFalse();
	});
});
