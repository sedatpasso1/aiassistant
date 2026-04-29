// Vercel'e deploy et
export default async function handler(req, res) {
  const { message } = req.body;
  if (message?.type !== 'end-of-call-report') 
    return res.json({ ok: true });
  
  // Transkripti Supabase'e kaydet
  await supabase.from('calls').insert({
    caller_phone: message.call.customer.number,
    transcript: message.transcript,
    duration_seconds: message.durationSeconds,
  });
  
  res.json({ success: true });
}
