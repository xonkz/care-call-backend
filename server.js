/**
 * Care Voice Caller — Express backend
 *
 * Flow:
 *   1. Receive { to, text } from the MFE
 *   2. Use Twilio's <Say> verb with inline TwiML (no callback URL needed)
 *   3. Return { success: true, callSid }
 *
 * Required env vars:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
 *   PUBLIC_BASE_URL (kept for future Deepgram upgrade)
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import twilio from 'twilio';

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    env: {
      twilio_sid:   !!process.env.TWILIO_ACCOUNT_SID,
      twilio_token: !!process.env.TWILIO_AUTH_TOKEN,
      twilio_from:  process.env.TWILIO_FROM_NUMBER ?? 'NOT SET',
      public_base_url: process.env.PUBLIC_BASE_URL ?? 'NOT SET',
    },
  });
});

// ── POST /api/voice/call ──────────────────────────────────────────────────────
//cam

app.post('/api/voice/call', async (req, res) => {
  const { to, text } = req.body ?? {};

  if (!to || !text) {
    return res.status(400).json({
      error: 'Both "to" (phone number) and "text" fields are required.',
    });
  }

  const missing = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'].filter(
    (k) => !process.env[k]
  );
  if (missing.length > 0) {
    return res.status(500).json({
      error: `Missing environment variables: ${missing.join(', ')}. Check your .env file.`,
    });
  }

  try {
    console.log('[1/1] Placing Twilio call via inline TwiML <Say>…');
    console.log(`       To:   ${to}`);
    console.log(`       From: ${process.env.TWILIO_FROM_NUMBER}`);

    // Escape XML special characters
    const safe = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    // Build TwiML string inline — no callback URL needed, works on trial accounts
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice" language="en-GB">${safe}</Say></Response>`;

    console.log('       TwiML:', twiml.substring(0, 120) + '…');

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const call = await client.calls.create({
      from: process.env.TWILIO_FROM_NUMBER,
      to,
      twiml,   // inline TwiML — no URL fetch required
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
  console.log(`   POST /api/voice/call  — place an outbound call`);
  console.log(`   GET  /health          — check env vars\n`);
});
