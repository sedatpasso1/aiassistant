import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'VoiceEstate webhook aktif' });
  }

  const msg = req.body?.message;
  if (!msg || msg.type !== 'end-of-call-report') {
    return res.status(200).json({ received: true });
  }

  const { data, error } = await supabase.from('calls').insert({
    caller_phone: msg.call?.customer?.number || 'web-test',
    duration_seconds: Math.round(msg.durationSeconds || 0),
    transcript: msg.artifact?.messages || [],
    summary: msg.artifact?.transcript || '',
    created_at: new Date().toISOString(),
  });

  console.log('INSERT DATA:', JSON.stringify(data));
  console.log('INSERT ERROR:', JSON.stringify(error));

  return res.status(200).json({ success: true });
}
