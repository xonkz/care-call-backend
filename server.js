import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import twilio from 'twilio';

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/voice/call', async (req, res) => {
  const { to, text } = req.body ?? {};

  if (!to || !text) {
    return res.status(400).json({ error: 'Both "to" and "text" are required.' });
  }

  const missing = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'].filter(
    (k) => !process.env[k]
  );
  if (missing.length > 0) {
    return res.status(500).json({ error: `Missing environment variables: ${missing.join(', ')}` });
  }

  try {
    const safe = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    const twimlString = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice" language="en-GB">${safe}</Say></Response>`;

    console.log('Placing call to', to, 'from', process.env.TWILIO_FROM_NUMBER);
    console.log('TwiML:', twimlString.substring(0, 80));

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const call = await client.calls.create({
      from: process.env.TWILIO_FROM_NUMBER,
      to,
      twiml: twimlString,
    });

    console.log('Call SID:', call.sid);
    return res.json({ success: true, callSid: call.sid });

  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: err.message ?? 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Care Voice Caller running on port ${PORT}`);
});
