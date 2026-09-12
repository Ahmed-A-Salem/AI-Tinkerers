/**
 * Turn demo/narration.txt into demo/narration.mp3 with ElevenLabs.
 *
 *   npm run narrate                 # whole script as one file
 *   npm run narrate -- --blocks     # one mp3 per numbered block (demo/narration-1.mp3 ...)
 *
 * Env: ELEVENLABS_API_KEY (required), ELEVENLABS_VOICE_ID (optional; default "Rachel"),
 *      ELEVENLABS_MODEL (optional; default eleven_multilingual_v2).
 * Stage directions in [brackets] are stripped; they are not spoken.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';

const key = process.env.ELEVENLABS_API_KEY;
if (!key) {
  console.error('ELEVENLABS_API_KEY missing in .env');
  process.exit(1);
}
const voice = process.env.ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM';
const model = process.env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2';
const perBlock = process.argv.includes('--blocks');

const raw = readFileSync('demo/narration.txt', 'utf8');
// Split on the "[n · ...]" headers; drop the bracketed stage directions.
const blocks = raw
  .split(/^\[\d+ ·[^\]]*\]\s*$/m)
  .map((b) => b.replace(/\[[^\]]*\]/g, '').trim())
  .filter(Boolean);

async function speak(text: string): Promise<Buffer> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key!, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: {
        stability: Number(process.env.ELEVENLABS_STABILITY ?? 0.38),
        similarity_boost: 0.8,
        style: Number(process.env.ELEVENLABS_STYLE ?? 0.45),
        use_speaker_boost: true,
      },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  console.log(`${blocks.length} blocks, ${raw.split(/\s+/).length} words, voice ${voice}, model ${model}`);
  if (perBlock) {
    for (const [i, block] of blocks.entries()) {
      const out = `demo/narration-${i + 1}.mp3`;
      writeFileSync(out, await speak(block));
      console.log(`wrote ${out}`);
    }
  } else {
    const audio = await speak(blocks.join('\n\n'));
    const target = process.env.NARRATION_OUT ?? 'demo/narration.mp3';
    writeFileSync(target, audio);
    console.log(`wrote ${target} (${(audio.length / 1024).toFixed(0)} KB)`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
