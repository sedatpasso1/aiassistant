export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'VoiceEstate webhook aktif' });
  }

  const { message } = req.body;

  if (!message || message.type !== 'end-of-call-report') {
    return res.status(200).json({ received: true });
  }

  console.log('Çağrı bitti:', {
    duration: message.durationSeconds,
    caller: message.call?.customer?.number,
    transcript: message.transcript,
  });

  return res.status(200).json({ success: true });
}
