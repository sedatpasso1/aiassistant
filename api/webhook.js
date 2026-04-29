import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'VoiceEstate webhook aktif' });
  }

  const { message } = req.body;

  if (!message || message.type !== 'end-of-call-report') {
    return res.status(200).json({ received: true });
  }

  const { call, transcript, durationSeconds, summary } = message;

  await supabase.from('calls').insert({
    caller_phone: call?.customer?.number || 'bilinmiyor',
    duration_seconds: durationSeconds || 0,
    transcript: transcript || [],
    summary: summary || '',
    created_at: new Date().toISOString(),
  });

  return res.status(200).json({ success: true });
}
