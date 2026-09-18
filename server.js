/**
 * Care Voice Caller — Express backend
 *
 * Flow:
 *   1. Receive { to, text } from the MFE
 *   2. Use Twilio's <Say> verb to read the text directly over the call
 *      (no Deepgram or audio file needed — works on Twilio trial accounts)
 *   3. Return { success: true, callSid }
 *
 * Required env vars:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, PUBLIC_BASE_URL
 *
 * Optional (kept for future use when upgrading to paid Twilio):
 *   DEEPGRAM_API_KEY
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import twilio from 'twilio';

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
// cam

app.use(cors());
app.use(express.json());

// Store the current text to speak (in-memory, single-user prototype)
let currentText = '';

// ── TwiML endpoint ────────────────────────────────────────────────────────────
// Twilio calls this URL when the call connects.
// <Say> reads the text directly — no audio file or geo permissions needed.

app.get('/twiml', (req, res) => {
  const text = currentText || 'Hello. This is an automated care update. Thank you.';
  // Escape XML special characters
  const safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  res.set('Content-Type', 'text/xml');
  res.send(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Amy">${safe}</Say></Response>`
  );
});

// ── POST /api/voice/call ──────────────────────────────────────────────────────

app.post('/api/voice/call', async (req, res) => {
  const { to, text } = req.body ?? {};

  if (!to || !text) {
    res.status(400).json({ error: 'Both "to" (phone number) and "text" fields are required.' });
    return;
  }

  // Validate required env vars
  const missing = [
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
    // Store the text so /twiml can serve it when Twilio calls back
    currentText = text;

    console.log('[1/2] Placing Twilio call via <Say>…');
    console.log(`       To: ${to}`);
    console.log(`       From: ${process.env.TWILIO_FROM_NUMBER}`);

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const twimlUrl = `${process.env.PUBLIC_BASE_URL}/twiml`;
    console.log(`       TwiML URL: ${twimlUrl}`);

    const call = await client.calls.create({
      from: process.env.TWILIO_FROM_NUMBER,
      to,
      url: twimlUrl,
    });

    console.log(`[2/2] Call placed! SID: ${call.sid}`);

    res.json({ success: true, callSid: call.sid });
  } catch (err) {
    console.error('[/api/voice/call] Error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', env: {
    twilio_sid: !!process.env.TWILIO_ACCOUNT_SID,
    twilio_token: !!process.env.TWILIO_AUTH_TOKEN,
    twilio_from: process.env.TWILIO_FROM_NUMBER,
    public_base_url: process.env.PUBLIC_BASE_URL,
  }});
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🩺  Care Voice Caller backend running on http://localhost:${PORT}`);
  console.log(`   POST /api/voice/call — place an outbound call`);
  console.log(`   GET  /twiml          — TwiML endpoint (called by Twilio)`);
  console.log(`   GET  /health         — check env vars\n`);
});
