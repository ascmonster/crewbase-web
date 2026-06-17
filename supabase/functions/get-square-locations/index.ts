import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SQ_VERSION = '2024-01-17'

function squareApiBase(): string {
  const env = Deno.env.get('SQUARE_ENVIRONMENT') ?? 'production'
  return env === 'sandbox'
    ? 'https://connect.squareupsandbox.com/v2'
    : 'https://connect.squareup.com/v2'
}

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return jsonRes({ error: 'Unauthorized' }, 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', ''),
    )
    if (authErr || !user) return jsonRes({ error: 'Unauthorized' }, 401)

    const { event_id } = await req.json()
    if (!event_id) return jsonRes({ error: 'event_id required' }, 400)

    // Verify caller is promoter of this event
    const { data: event, error: evErr } = await supabase
      .from('events')
      .select('id, promoter_id')
      .eq('id', event_id)
      .single()

    if (evErr || !event) return jsonRes({ error: 'Event not found' }, 404)
    if (event.promoter_id !== user.id) return jsonRes({ error: 'Forbidden' }, 403)

    // Get the Square access token for this event
    const { data: cfg, error: cfgErr } = await supabase
      .from('event_square_config')
      .select('square_access_token')
      .eq('event_id', event_id)
      .single()

    if (cfgErr || !cfg?.square_access_token) {
      return jsonRes({ error: 'Square not connected for this event' }, 404)
    }

    // Fetch locations from Square
    const sqRes = await fetch(`${squareApiBase()}/locations`, {
      headers: {
        Authorization: `Bearer ${cfg.square_access_token}`,
        'Square-Version': SQ_VERSION,
      },
    })

    const rawBody = await sqRes.text()

    if (!sqRes.ok) {
      console.error('[square] locations error:', sqRes.status, rawBody)
      return jsonRes({ error: `Square API error: ${rawBody}` }, 502)
    }

    const sqData = JSON.parse(rawBody)
    const locations = (sqData.locations ?? []).map((loc: any) => ({
      id:      loc.id,
      name:    loc.name,
      address: loc.address ?? null,
    }))

    return jsonRes({ locations })
  } catch (err: any) {
    console.error('[get-square-locations] unhandled error:', err.message)
    return jsonRes({ error: err.message }, 500)
  }
})
