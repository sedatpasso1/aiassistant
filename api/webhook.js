import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'VoiceEstate webhook aktif' });
  }

  const msg = req.body?.message;
  if (!msg || msg.type !== 'end-of-call-report') {
    return res.status(200).json({ received: true });
  }

  const transcript = msg.artifact?.transcript || '';
  const messages = msg.artifact?.messages || [];

  let analysis = { intent: 'BILGI', lead_score: 30, summary: '', slots: {} };

  try {
    const completion = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `Emlak ofisi çağrı transkriptini analiz et. Sadece JSON döndür, başka hiçbir şey yazma:
{
  "intent": "SATIN_ALMA veya KIRA veya SATIS veya BILGI",
  "lead_score": 0-100 arası sayı,
  "summary": "1-2 cümle özet",
  "slots": {
    "district": null,
    "room_count": null,
    "budget": null,
    "appointment_requested": false
  }
}

Transkript:
${transcript}`
        }
      ]
    });

    analysis = JSON.parse(completion.content[0].text);
  } catch (e) {
    console.log('Anthropic error:', e.message);
  }

  try {
    await supabase.from('calls').insert({
      caller_phone: msg.call?.customer?.number || 'web-test',
      duration_seconds: Math.round(msg.durationSeconds || 0),
      transcript: messages,
      summary: analysis.summary,
      intent: analysis.intent,
      lead_score: analysis.lead_score,
      slots: analysis.slots,
      status: analysis.slots?.appointment_requested ? 'randevu_alindi' : 'bilgi_verildi',
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.log('Supabase error:', e.message);
  }

  console.log('INTENT:', analysis.intent, '| SCORE:', analysis.lead_score);
  return res.status(200).json({ success: true });
}
