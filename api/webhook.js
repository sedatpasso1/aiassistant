import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'VoiceEstate webhook aktif' });
  }

  const body = req.body;
  console.log('GELEN DATA:', JSON.stringify(body, null, 2));

  const messageType = body?.message?.type;
  console.log('MESSAGE TYPE:', messageType);

  // Her POST'u kaydet, filtre yok
  await supabase.from('calls').insert({
    caller_phone: body?.message?.call?.customer?.number || 'test',
    duration_seconds: body?.message?.durationSeconds || 0,
    transcript: body?.message?.transcript || [],
    summary: body?.message?.summary || '',
    created_at: new Date().toISOString(),
  });

  return res.status(200).json({ success: true, type: messageType });
}
