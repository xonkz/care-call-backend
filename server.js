/**
 * Care Voice Caller — Express backend
 *
 * Flow:
 *   1. Receive { to, text } from the MFE
 *   2. POST text → Deepgram TTS → receive MP3 audio buffer
 *   3. Save MP3 to /tmp/summary.mp3 and expose it on GET /audio/summary.mp3
 *   4. Use Twilio SDK to place an outbound call with <Play> TwiML pointing at the audio URL
 *   5. Return { success: true, callSid }
 *
 * Required env vars (copy .env.example → .env and fill them in):
 *   DEEPGRAM_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
 *   TWILIO_FROM_NUMBER, PUBLIC_BASE_URL
 */

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import dotenv from 'dotenv';
import twilio from 'twilio';

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 3001;

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// ── Audio file route ──────────────────────────────────────────────────────────
// Twilio fetches this URL when the call connects.

app.get('/audio/summary.mp3', (req, res) => {
  const filePath = '/tmp/summary.mp3';

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Audio file not found' });
    return;
  }

  res.set('Content-Type', 'audio/mpeg');
  res.sendFile(filePath);
});

// ── POST /api/voice/call ──────────────────────────────────────────────────────

app.post('/api/voice/call', async (req, res) => {
  const { to, text } = req.body ?? {};

  if (!to || !text) {
    res.status(400).json({ error: 'Both "to" (phone number) and "text" fields are required.' });
    return;
  }

  // Validate that all required env vars are set
  const missing = [
    'DEEPGRAM_API_KEY',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_FROM_NUMBER',
    'PUBLIC_BASE_URL',
  ].filter((key) => !process.env[key]);

  if (missing.length > 0) {
    res.status(500).json({
      error: `Missing environment variables: ${missing.join(', ')}. Check your .env file.`,
    });
    return;
  }

  try {
    // ── Step 1: Deepgram TTS ────────────────────────────────────────────────
    console.log('[1/3] Calling Deepgram TTS…');

    const dgRes = await fetch('https://api.deepgram.com/v1/speak?model=aura-asteria-en', {
      method: 'POST',
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!dgRes.ok) {
      const errBody = await dgRes.text();
      console.error('[Deepgram] Error response:', errBody);
      res.status(502).json({ error: `Deepgram TTS failed (${dgRes.status}): ${errBody}` });
      return;
    }

    // ── Step 2: Save MP3 to /tmp ────────────────────────────────────────────
    console.log('[2/3] Saving audio to /tmp/summary.mp3…');

    const audioArrayBuffer = await dgRes.arrayBuffer();
    fs.writeFileSync('/tmp/summary.mp3', Buffer.from(audioArrayBuffer));

    const audioUrl = `${process.env.PUBLIC_BASE_URL}/audio/summary.mp3`;
    console.log(`       Audio URL: ${audioUrl}`);

    // ── Step 3: Twilio outbound call ────────────────────────────────────────
    console.log('[3/3] Placing Twilio call…');

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const call = await client.calls.create({
      from: process.env.TWILIO_FROM_NUMBER,
      to,
      twiml: `<Response><Play>${audioUrl}</Play></Response>`,
    });

    console.log(`      Call SID: ${call.sid}`);

    res.json({ success: true, callSid: call.sid });
  } catch (err) {
    console.error('[/api/voice/call] Unexpected error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🩺  Care Voice Caller backend running on http://localhost:${PORT}`);
  console.log(`   POST /api/voice/call   — place an outbound call`);
  console.log(`   GET  /audio/summary.mp3 — serve the generated MP3 to Twilio\n`);
});
