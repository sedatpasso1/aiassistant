import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text?.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function messagesToPlainText(messages, fallbackTranscript = '') {
  if (fallbackTranscript) return fallbackTranscript;
  if (!Array.isArray(messages)) return '';

  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      const role = m.role === 'bot' ? 'AI' : 'User';
      return `${role}: ${m.message || m.content || ''}`;
    })
    .join('\n');
}

function temperatureFromScore(score) {
  if (score >= 75) return 'hot';
  if (score >= 45) return 'warm';
  return 'cold';
}

function normalizeAnalysis(raw) {
  const score = Number(raw?.lead_score);
  const cleanScore = Number.isFinite(score)
    ? Math.max(0, Math.min(100, score))
    : 30;

  return {
    caller_name: raw?.caller_name || null,
    intent: raw?.intent || 'BILGI',
    lead_score: cleanScore,
    temperature: temperatureFromScore(cleanScore),
    summary: raw?.summary || 'Çağrı kaydedildi, AI özeti üretilemedi.',
    status:
      raw?.status ||
      (raw?.slots?.appointment_requested ? 'randevu_alindi' : 'bilgi_verildi'),
    slots: {
      district: raw?.slots?.district || null,
      room_count: raw?.slots?.room_count || null,
      budget: raw?.slots?.budget || null,
      property_type: raw?.slots?.property_type || null,
      appointment_requested: Boolean(raw?.slots?.appointment_requested),
      preferred_time: raw?.slots?.preferred_time || null,
      urgency: raw?.slots?.urgency || null,
    },
  };
}

async function upsertLead({ insertedCall, analysis }) {
  const phone = insertedCall.caller_phone || 'web-test';

  const { data: existing } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();

  const payload = {
    tenant_id: insertedCall.tenant_id || null,
    phone,
    name: analysis.caller_name || existing?.name || null,
    intent: analysis.intent || existing?.intent || 'BILGI',
    lead_score: analysis.lead_score,
    temperature: analysis.temperature,
    district: analysis.slots?.district || existing?.district || null,
    room_count: analysis.slots?.room_count || existing?.room_count || null,
    budget: analysis.slots?.budget || existing?.budget || null,
    property_type: analysis.slots?.property_type || existing?.property_type || null,
    urgency: analysis.slots?.urgency || existing?.urgency || null,
    appointment_requested:
      analysis.slots?.appointment_requested || existing?.appointment_requested || false,
    summary: analysis.summary || existing?.summary || null,
    status: analysis.temperature === 'hot' ? 'hot_lead' : existing?.status || 'new',
    last_call_id: insertedCall.id,
    last_call_at: insertedCall.created_at,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    await supabase
      .from('leads')
      .update({
        ...payload,
        call_count: (existing.call_count || 1) + 1,
      })
      .eq('id', existing.id);
  } else {
    await supabase.from('leads').insert(payload);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({
      status: 'VoiceEstate webhook aktif',
      route: '/api/webhook',
    });
  }

  const msg = req.body?.message;

  if (!msg || msg.type !== 'end-of-call-report') {
    return res.status(200).json({
      received: true,
      ignored: true,
    });
  }

  const messages = msg.artifact?.messages || [];
  const transcriptText = messagesToPlainText(
    messages,
    msg.artifact?.transcript || ''
  );

  let analysis = normalizeAnalysis(null);

  try {
    const todayTR = new Date().toLocaleDateString('tr-TR', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    const completion = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      messages: [
        {
          role: 'user',
          content: `
Sen bir emlak ofisi çağrı analiz motorusun.

Sadece geçerli JSON döndür. Markdown, açıklama veya ek metin yazma.

Bugünün tarihi: ${todayTR}
Timezone: Europe/Istanbul

JSON formatı:
{
  "caller_name": null,
  "intent": "SATIN_ALMA | KIRA | SATIS | BILGI",
  "lead_score": 0,
  "summary": "1-2 cümle Türkçe özet",
  "status": "randevu_alindi | bilgi_verildi | degerleme_talebi | takip_gerekli",
  "slots": {
    "district": null,
    "room_count": null,
    "budget": null,
    "property_type": null,
    "appointment_requested": false,
    "preferred_time": null,
    "urgency": null
  }
}

Kurallar:
- Ev almak istiyorsa intent SATIN_ALMA.
- Kiralık arıyorsa intent KIRA.
- Evini satmak istiyorsa intent SATIS.
- Sadece soru soruyorsa intent BILGI.
- Randevu, görüşme, ofise gelme, danışman arasın gibi ifade varsa appointment_requested true.
- preferred_time varsa ISO formatında döndür: YYYY-MM-DDTHH:mm:ss+03:00
- "yarın 14:30" gibi ifadeleri bugünün tarihine göre ISO tarihe çevir.
- Lead score 75+ sıcak, 45-74 orta, 0-44 düşük.
- Transkript anlamsızsa intent BILGI, lead_score 10-30 arası ver.

Transkript:
${transcriptText}
          `.trim(),
        },
      ],
    });

    const rawText = completion.content?.[0]?.text || '';
    const parsed = safeJsonParse(rawText);
    analysis = normalizeAnalysis(parsed);
  } catch (e) {
    console.log('Anthropic error:', e?.message || e);
  }

  let insertedCall = null;

  try {
    const { data, error } = await supabase
      .from('calls')
      .insert({
        tenant_id: null,
        caller_phone: msg.call?.customer?.number || 'web-test',
        caller_name: analysis.caller_name,
        duration_seconds: Math.round(msg.durationSeconds || 0),
        transcript: messages,
        summary: analysis.summary,
        intent: analysis.intent,
        lead_score: analysis.lead_score,
        slots: analysis.slots,
        status: analysis.status,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    insertedCall = data;
  } catch (e) {
    console.log('Supabase calls insert error:', e?.message || e);
    return res.status(500).json({
      success: false,
      error: 'calls_insert_failed',
      detail: e?.message || String(e),
    });
  }

  try {
    await upsertLead({ insertedCall, analysis });
  } catch (e) {
    console.log('Lead upsert error:', e?.message || e);
  }

  if (analysis.slots?.appointment_requested && insertedCall) {
    try {
      const { error } = await supabase.from('appointments').insert({
        call_id: insertedCall.id,
        tenant_id: insertedCall.tenant_id || null,
        client_name: analysis.caller_name || 'Bilinmeyen Müşteri',
        client_phone: insertedCall.caller_phone,
        scheduled_at: analysis.slots?.preferred_time || null,
        status: 'talep_alindi',
        appointment_type: analysis.intent,
        notes: analysis.summary,
        source: 'ai_call',
      });

      if (error) throw error;
    } catch (e) {
      console.log('Supabase appointments insert error:', e?.message || e);
    }
  }

  console.log(
    'CALL SAVED:',
    insertedCall?.id,
    '| INTENT:',
    analysis.intent,
    '| SCORE:',
    analysis.lead_score
  );

  return res.status(200).json({
    success: true,
    call_id: insertedCall?.id,
    analysis,
  });
}
