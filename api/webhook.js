import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

  // Intent + slot analysis
  let analysis = { intent: 'BILGI', lead_score: 30, summary: '', slots: {} };
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Emlak ofisi çağrı transkriptini analiz et. Sadece JSON döndür:
{
  "intent": "SATIN_ALMA|KIRA|SATIS|BILGI",
  "lead_score": 0-100,
  "summary": "1-2 cümle özet",
  "slots": {
    "district": null,
    "room_count": null,
    "budget": null,
    "appointment_requested": false
  }
}`
        },
        { role: 'user', content: `Transkript:\n${transcript}` }
      ],
      response_format: { type: 'json_object' }
    });
    analysis = JSON.parse(completion.choices[0].message.content);
  } catch (e) {
    console.log('OpenAI error:', e.message);
  }

  // Supabase'e kaydet
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

  console.log('INTENT:', analysis.intent, '| SCORE:', analysis.lead_score);
  return res.status(200).json({ success: true });
}
