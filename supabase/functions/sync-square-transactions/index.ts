import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SQ_VERSION = '2024-11-20'

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

async function fetchPaymentsForLocation(
  token: string,
  locationId: string,
): Promise<{ payments: any[]; error?: string }> {
  try {
    const url = `${squareApiBase()}/payments?location_id=${encodeURIComponent(locationId)}&limit=100&sort_order=DESC`
    console.log('[square] GET', url)

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Square-Version': SQ_VERSION,
      },
    })

    const rawBody = await res.text()
    console.log('[square] status:', res.status, 'location:', locationId)

    if (!res.ok) {
      return { payments: [], error: `Square ${res.status}: ${rawBody}` }
    }

    const data = JSON.parse(rawBody)
    const payments: any[] = (data.payments ?? []).filter(
      (p: any) => p.status === 'COMPLETED',
    )
    return { payments }
  } catch (e: any) {
    console.error('[square] fetch threw:', e.message)
    return { payments: [], error: e.message }
  }
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

    // Fetch the promoter's Square access token for this event
    const { data: squareCfg, error: cfgErr } = await supabase
      .from('event_square_config')
      .select('square_access_token, square_merchant_id')
      .eq('event_id', event_id)
      .single()

    if (cfgErr || !squareCfg?.square_access_token) {
      return jsonRes({ error: 'Square not connected for this event' }, 400)
    }

    const accessToken: string = squareCfg.square_access_token

    // Fetch all vendor splits that have a Square location ID
    const { data: splits, error: splitsErr } = await supabase
      .from('event_vendor_splits')
      .select('vendor_id, square_location_id')
      .eq('event_id', event_id)
      .not('square_location_id', 'is', null)

    if (splitsErr) {
      console.error('[splits] query error:', splitsErr.message)
      return jsonRes({ error: 'Failed to fetch vendor splits' }, 500)
    }

    const vendorSplits = splits ?? []
    console.log('[sync] event_id:', event_id, '— vendor locations to sync:', vendorSplits.length)

    let totalSynced = 0
    let vendorsProcessed = 0

    for (const split of vendorSplits) {
      const { vendor_id, square_location_id } = split
      if (!square_location_id) continue

      console.log('[sync] vendor:', vendor_id, 'location:', square_location_id)
      const { payments, error: payErr } = await fetchPaymentsForLocation(accessToken, square_location_id)

      if (payErr) {
        console.error('[sync] payment fetch error for vendor', vendor_id, ':', payErr)
        continue
      }

      if (payments.length === 0) {
        console.log('[sync] no completed payments for location', square_location_id)
        vendorsProcessed++
        continue
      }

      const txRows = payments.map((p: any) => {
        const feeTotal = (p.processing_fee ?? []).reduce(
          (s: number, f: any) => s + (f.amount_money?.amount ?? 0),
          0,
        )
        return {
          transaction_id:    p.id,
          vendor_id,
          event_id,
          location_id:       square_location_id,
          amount_cents:      p.amount_money?.amount ?? 0,
          net_amount_cents:  (p.amount_money?.amount ?? 0) - feeTotal,
          payment_method:    p.source_type === 'CASH' ? 'cash' : p.source_type === 'CARD' ? 'card' : p.source_type?.toLowerCase() ?? p.payment_method_type?.toLowerCase() ?? null,
          square_created_at: p.created_at,
        }
      })

      const { error: upsertErr } = await supabase
        .from('square_transactions')
        .upsert(txRows, {
          onConflict: 'transaction_id',
          ignoreDuplicates: false,
        })

      // After upsert, restore payment_method = 'cash' for any cash rows
      // that may have been overwritten, since we set these explicitly
      // via record-cash-payment and Square may return a different format
      const cashTransactionIds = txRows
        .filter(r => r.payment_method === 'cash')
        .map(r => r.transaction_id)
        .filter(Boolean)

      if (cashTransactionIds.length > 0) {
        await supabase
          .from('square_transactions')
          .update({ payment_method: 'cash' })
          .in('transaction_id', cashTransactionIds)
      }

      if (upsertErr) {
        console.error('[sync] upsert error for vendor', vendor_id, ':', upsertErr.message)
      } else {
        totalSynced += txRows.length
        console.log('[sync] upserted', txRows.length, 'transactions for vendor', vendor_id)
      }

      vendorsProcessed++
    }

    return jsonRes({ synced: totalSynced, vendors: vendorsProcessed })
  } catch (err: any) {
    console.error('[sync-square-transactions] unhandled error:', err.message)
    return jsonRes({ error: err.message }, 500)
  }
})
