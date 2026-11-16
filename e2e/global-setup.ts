import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { FACES_SOURCE, FIXTURES, FIXTURES_DIR, hasFacesSource } from './fixtures';

function ffmpeg(args: string[]) {
	execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
}

/** Genera i video di prova con ffmpeg, solo se mancano. */
export default function globalSetup() {
	mkdirSync(FIXTURES_DIR, { recursive: true });

	if (!existsSync(FIXTURES.noAudio)) {
		ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=3',
			'-c:v', 'libx264', '-pix_fmt', 'yuv420p', FIXTURES.noAudio]);
	}
	if (!existsSync(FIXTURES.invalid)) {
		writeFileSync(FIXTURES.invalid, 'questo non è un video');
	}

	if (!hasFacesSource()) {
		console.warn(`[e2e] Sorgente con volti non trovata (${FACES_SOURCE}): i test sui volti verranno saltati.`);
		return;
	}
	if (!existsSync(FIXTURES.faces)) {
		ffmpeg(['-ss', '10', '-t', '5', '-i', FACES_SOURCE,
			'-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', FIXTURES.faces]);
	}
	if (!existsSync(FIXTURES.facesRotated)) {
		// Pixel ruotati di 90° in senso antiorario + metadato che li riporta dritti in visualizzazione.
		const tmp = FIXTURES.facesRotated.replace('.mp4', '.tmp.mp4');
		ffmpeg(['-i', FIXTURES.faces, '-vf', 'transpose=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'copy', tmp]);
		ffmpeg(['-display_rotation', '-90', '-i', tmp, '-c', 'copy', FIXTURES.facesRotated]);
	}
	if (!existsSync(FIXTURES.facesWebm)) {
		ffmpeg(['-ss', '20', '-t', '3', '-i', FACES_SOURCE,
			'-c:v', 'libvpx-vp9', '-b:v', '1M', '-deadline', 'realtime', '-c:a', 'libopus', FIXTURES.facesWebm]);
	}
}
