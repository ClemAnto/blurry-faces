import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Cartella (ignorata da git) dove global-setup genera i video di prova con ffmpeg. */
export const FIXTURES_DIR = resolve(__dirname, '.fixtures');

/**
 * Sorgente con volti reali da cui ritagliare i clip di prova. Non è versionata: di default è il video di esempio
 * del repository face-api.js clonato accanto a questo progetto; si può indicare un altro file con FACES_VIDEO.
 */
export const FACES_SOURCE = process.env['FACES_VIDEO']
	?? resolve(__dirname, '../../face-api.js/examples/media/bbt.mp4');

export const fixture = (name: string) => resolve(FIXTURES_DIR, name);

export const FIXTURES = {
	/** 5 s con volti, H.264 + AAC. */
	faces: fixture('faces.mp4'),
	/** Stesso clip con i pixel ruotati e metadato di rotazione che li riporta dritti, come i video da telefono. */
	facesRotated: fixture('faces-rotated.mp4'),
	/** 3 s con volti, VP9 + Opus in WebM. */
	facesWebm: fixture('faces.webm'),
	/** 3 s sintetici senza audio e senza volti. */
	noAudio: fixture('no-audio.mp4'),
	/** File di testo con estensione .mp4. */
	invalid: fixture('invalid.mp4'),
};

export const hasFacesSource = () => existsSync(FACES_SOURCE);

export interface StreamInfo {
	codec_type: 'video' | 'audio';
	codec_name: string;
	width?: number;
	height?: number;
	nb_read_packets?: string;
	side_data_list?: { rotation?: number }[];
}

export function probe(file: string): { streams: StreamInfo[]; format: { duration: string } } {
	const out = execFileSync('ffprobe', [
		'-v', 'error', '-count_packets',
		'-show_entries', 'stream=codec_type,codec_name,width,height,nb_read_packets:stream_side_data=rotation:format=duration',
		'-of', 'json', file,
	], { encoding: 'utf8' });
	return JSON.parse(out);
}

export const videoStream = (file: string) => probe(file).streams.find(s => s.codec_type === 'video')!;
export const audioStream = (file: string) => probe(file).streams.find(s => s.codec_type === 'audio');
