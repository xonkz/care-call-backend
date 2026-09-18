import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import twilio from 'twilio';
import { createWriteStream, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pipeline } from 'stream/promises';

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 3001;
const AUDIO_PATH = join(tmpdir(), 'summary.mp3');

app.use(cors());
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    env: {
      deepgram:     !!process.env.DEEPGRAM_API_KEY,
      twilio_sid:   !!process.env.TWILIO_ACCOUNT_SID,
      twilio_token: !!process.env.TWILIO_AUTH_TOKEN,
      twilio_from:  process.env.TWILIO_FROM_NUMBER ?? 'NOT SET',
      public_url:   process.env.PUBLIC_BASE_URL ?? 'NOT SET',
    },
  });
});

// ── Serve MP3 to Twilio ───────────────────────────────────────────────────────

app.get('/audio/summary.mp3', (_req, res) => {
  if (!existsSync(AUDIO_PATH)) {
    return res.status(404).json({ error: 'Audio not yet generated' });
  }
  res.set('Content-Type', 'audio/mpeg');
  res.send(readFileSync(AUDIO_PATH));
});

// ── POST /api/voice/call ──────────────────────────────────────────────────────

app.post('/api/voice/call', async (req, res) => {
  const { to, text } = req.body ?? {};

  if (!to || !text) {
    return res.status(400).json({ error: 'Both "to" and "text" are required.' });
  }

  const missing = [
    'DEEPGRAM_API_KEY',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_FROM_NUMBER',
    'PUBLIC_BASE_URL',
  ].filter((k) => !process.env[k]);

  if (missing.length > 0) {
    return res.status(500).json({
      error: `Missing environment variables: ${missing.join(', ')}. Check your .env file.`,
    });
  }

  try {
    // ── Step 1: Deepgram TTS ────────────────────────────────────────────────
    console.log('[1/3] Calling Deepgram TTS…');

    const dgResponse = await fetch(
      'https://api.deepgram.com/v1/speak?model=aura-athena-en',
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      }
    );

    if (!dgResponse.ok) {
      const errText = await dgResponse.text();
      throw new Error(`Deepgram error ${dgResponse.status}: ${errText}`);
    }

    // ── Step 2: Save MP3 ────────────────────────────────────────────────────
    console.log(`[2/3] Saving audio to ${AUDIO_PATH}…`);
    await pipeline(dgResponse.body, createWriteStream(AUDIO_PATH));

    const audioUrl = `${process.env.PUBLIC_BASE_URL}/audio/summary.mp3`;
    console.log(`       Audio URL: ${audioUrl}`);

    // ── Step 3: Place Twilio call ───────────────────────────────────────────
    console.log('[3/3] Placing Twilio call…');

    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Play>${audioUrl}</Play></Response>`;

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const call = await client.calls.create({
      from: process.env.TWILIO_FROM_NUMBER,
      to,
      twiml,
    });

    console.log(`       Call SID: ${call.sid}`);
    return res.json({ success: true, callSid: call.sid });

  } catch (err) {
    console.error('[/api/voice/call] Error:', err.message ?? err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🩺  Care Voice Caller backend running on http://localhost:${PORT}`);
  console.log(`   POST /api/voice/call       — place an outbound call (Deepgram TTS)`);
  console.log(`   GET  /audio/summary.mp3    — serve the generated MP3 to Twilio`);
  console.log(`   GET  /health               — check env vars\n`);
});
