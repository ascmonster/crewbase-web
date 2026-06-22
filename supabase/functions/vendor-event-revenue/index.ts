import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SQUARE_API = 'https://connect.squareup.com/v2'
const SQ_VERSION = '2024-11-20'

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

async function squarePayments(
  token: string,
  locationId: string,
  beginTime: string,
  endTime: string,
): Promise<{ revenue: number; transactions: number; error?: string; rawPayments: any[] }> {
  try {
    const params = new URLSearchParams({
      location_id: locationId,
      begin_time: beginTime,
      end_time: endTime,
      sort_order: 'DESC',
    })
    const url = `${SQUARE_API}/payments?${params}`
    console.log('[square] GET', url)
    console.log('[square] location_id:', locationId)
    console.log('[square] begin_time:', beginTime)
    console.log('[square] end_time:', endTime)

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'Square-Version': SQ_VERSION },
    })

    const rawBody = await res.text()
    console.log('[square] status:', res.status)
    console.log('[square] response body:', rawBody)

    if (!res.ok) {
      return { revenue: 0, transactions: 0, error: `Square ${res.status}: ${rawBody}`, rawPayments: [] }
    }

    const data = JSON.parse(rawBody)
    const payments = ((data.payments as any[]) ?? []).filter(
      (p: any) => p.status === 'COMPLETED',
    )
    const revenue = payments.reduce(
      (s: number, p: any) => s + (p.total_money?.amount ?? 0),
      0,
    ) / 100
    return { revenue, transactions: payments.length, rawPayments: payments }
  } catch (err: any) {
    console.error('[square] fetch threw:', err.message)
    return { revenue: 0, transactions: 0, error: err.message, rawPayments: [] }
  }
}

async function storePaymentData(
  supabase: any,
  payments: any[],
  vendorId: string,
  truckId: string,
  eventId: string,
  locationId: string,
  eventTimezone: string,
  token: string,
): Promise<void> {
  try {
    const txRows = payments.map((p: any) => {
      const feeTotal = (p.processing_fee ?? []).reduce(
        (s: number, f: any) => s + (f.amount_money?.amount ?? 0), 0,
      )
      return {
        transaction_id:    p.id,
        vendor_id:         vendorId,
        truck_id:          truckId,
        event_id:          eventId,
        location_id:       locationId,
        amount_cents:      p.amount_money?.amount ?? 0,
        net_amount_cents:  (p.amount_money?.amount ?? 0) - feeTotal,
        tip_cents:         p.tip_money?.amount ?? 0,
        currency:          p.amount_money?.currency ?? null,
        payment_method:    p.payment_method_type ?? null,
        card_brand:        p.card_details?.card?.card_brand ?? null,
        order_id:          p.order_id ?? null,
        square_created_at: p.created_at,
        event_timezone:    eventTimezone,
      }
    })

    const { error: txErr } = await supabase
      .from('square_transactions')
      .upsert(txRows, { onConflict: 'transaction_id' })
    if (txErr) console.error('[store] square_transactions upsert error:', txErr.message)
  } catch (e: any) {
    console.error('[store] square_transactions threw:', e.message)
  }

  for (const payment of payments.filter((p: any) => p.order_id)) {
    try {
      const orderRes = await fetch(`${SQUARE_API}/orders/${payment.order_id}`, {
        headers: { Authorization: `Bearer ${token}`, 'Square-Version': SQ_VERSION },
      })
      if (!orderRes.ok) {
        console.warn('[store] order fetch failed for', payment.order_id, ':', orderRes.status)
        continue
      }
      const orderData = await orderRes.json()
      const lineItems: any[] = orderData.order?.line_items ?? []
      if (!lineItems.length) continue

      const itemRows = lineItems.map((li: any) => ({
        transaction_id:    payment.id,
        vendor_id:         vendorId,
        event_id:          eventId,
        item_name:         li.name,
        variation_name:    li.variation_name ?? null,
        quantity:          li.quantity,
        base_price_cents:  li.base_price_money?.amount ?? 0,
        total_price_cents: li.total_money?.amount ?? 0,
        category:          li.catalog_object_id ?? null,
        square_created_at: payment.created_at,
      }))

      // Delete then insert to avoid needing a complex composite unique key
      await supabase.from('square_order_items').delete().eq('transaction_id', payment.id)
      const { error: itemErr } = await supabase.from('square_order_items').insert(itemRows)
      if (itemErr) console.error('[store] square_order_items insert error:', itemErr.message)
    } catch (e: any) {
      console.error('[store] order fetch threw for', payment.order_id, ':', e.message)
    }
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
      .select('id, name, start_date, end_date, timezone, promoter_id, status')
      .eq('id', event_id)
      .single()

    if (evErr || !event) return jsonRes({ error: 'Event not found' }, 404)
    if (event.promoter_id !== user.id) return jsonRes({ error: 'Forbidden' }, 403)

    console.log('[event] name:', event.name)
    console.log('[event] raw start_date:', event.start_date)
    console.log('[event] raw end_date:', event.end_date)
    console.log('[event] status:', event.status)

    const isPast =
      event.status === 'completed' ||
      (event.end_date && new Date(event.end_date) < new Date())

    // All vendors for this event
    const { data: eventVendorRows } = await supabase
      .from('event_vendors')
      .select('vendor_id')
      .eq('event_id', event_id)

    // Declared trucks via event_trucks → vendor_trucks
    const { data: etRows } = await supabase
      .from('event_trucks')
      .select('vendor_trucks(id, name, square_location_id, square_location_name, vendor_id)')
      .eq('event_id', event_id)

    // Extra trucks added by promoter
    const { data: extraRows } = await supabase
      .from('event_vendor_extra_trucks')
      .select('id, vendor_id, square_location_id, truck_name')
      .eq('event_id', event_id)

    const allVendorIds = [
      ...new Set([
        ...(eventVendorRows ?? []).map((r: any) => r.vendor_id),
        ...(extraRows ?? []).map((r: any) => r.vendor_id),
      ]),
    ]

    // Vendor profiles (Square tokens + business names)
    const { data: profiles } = await supabase
      .from('vendor_profiles')
      .select('user_id, business_name, square_access_token, square_connected, square_merchant_name')
      .in('user_id', allVendorIds)

    const profileByVendor: Record<string, any> = {}
    for (const p of profiles ?? []) profileByVendor[p.user_id] = p

    // Existing snapshots for past events
    const snapshotByVendor: Record<string, any> = {}
    if (isPast) {
      const { data: snaps } = await supabase
        .from('event_vendor_revenue_snapshots')
        .select('vendor_id, snapshot, captured_at')
        .eq('event_id', event_id)
      for (const s of snaps ?? []) snapshotByVendor[s.vendor_id] = s
    }

    // Group trucks by vendor
    const trucksByVendor: Record<string, any[]> = {}
    for (const vid of allVendorIds) trucksByVendor[vid] = []

    for (const row of etRows ?? []) {
      const t = (row as any).vendor_trucks
      if (!t?.vendor_id) continue
      trucksByVendor[t.vendor_id] = trucksByVendor[t.vendor_id] ?? []
      trucksByVendor[t.vendor_id].push({
        truck_id:            t.id,
        truck_name:          t.name,
        square_location_id:  t.square_location_id,
        square_location_name: t.square_location_name ?? null,
        is_extra:            false,
      })
    }
    for (const et of extraRows ?? []) {
      trucksByVendor[et.vendor_id] = trucksByVendor[et.vendor_id] ?? []
      trucksByVendor[et.vendor_id].push({
        truck_id: et.id,
        truck_name: et.truck_name,
        square_location_id: et.square_location_id,
        is_extra: true,
      })
    }

    // ── Build Square time range using event timezone ──────────────────────────
    const eventTZ = event.timezone ?? 'Australia/Melbourne'

    // Convert YYYY-MM-DD + local time string to UTC ISO using the event timezone.
    // sv (Swedish) locale gives "YYYY-MM-DD HH:MM:SS" — reliable in Deno runtime.
    function localToUTC(dateStr: string, timeStr: string, tz: string): string {
      const ref      = new Date(`${dateStr}T12:00:00Z`)
      const utcSv    = ref.toLocaleString('sv', { timeZone: 'UTC' })
      const tzSv     = ref.toLocaleString('sv', { timeZone: tz })
      const offsetMs = new Date(tzSv.replace(' ', 'T') + 'Z').getTime() -
                       new Date(utcSv.replace(' ', 'T') + 'Z').getTime()
      return new Date(new Date(`${dateStr}T${timeStr}Z`).getTime() - offsetMs).toISOString()
    }

    const startDateStr = event.start_date.slice(0, 10)
    const endDateStr   = (event.end_date ?? event.start_date).slice(0, 10)
    const beginTime    = localToUTC(startDateStr, '00:00:00', eventTZ)
    let   endTime      = localToUTC(endDateStr,   '23:59:59', eventTZ)

    if (endTime <= beginTime) {
      console.warn('[time] endTime <= beginTime — adjusting endTime to beginTime + 1s')
      endTime = new Date(new Date(beginTime).getTime() + 1000).toISOString()
    }

    console.log('[time] eventTZ:', eventTZ)
    console.log('[time] beginTime sent to Square:', beginTime)
    console.log('[time] endTime sent to Square:', endTime)

    const vendorResults: any[] = []
    let eventTotal = 0

    for (const vendorId of allVendorIds) {
      const profile = profileByVendor[vendorId]
      const trucks  = trucksByVendor[vendorId] ?? []

      console.log('[vendor]', vendorId, '— trucks:', trucks.length, '— square_connected:', profile?.square_connected, '— has_token:', !!profile?.square_access_token)
      trucks.forEach(t => console.log('  truck:', t.truck_name, '| location_id:', t.square_location_id))

      // Past event with existing snapshot — return cached
      if (isPast && snapshotByVendor[vendorId]) {
        const snap = snapshotByVendor[vendorId]
        vendorResults.push({ ...snap.snapshot, _from_snapshot: true, _captured_at: snap.captured_at })
        eventTotal += snap.snapshot.vendor_total ?? 0
        continue
      }

      const token = profile?.square_access_token ?? null
      const truckResults: any[] = []
      let vendorTotal = 0

      for (const truck of trucks) {
        if (!truck.square_location_id || !token) {
          console.log('[truck] skipping', truck.truck_name, '— missing location_id:', !truck.square_location_id, '| missing token:', !token)
          truckResults.push({
            truck_id:             truck.truck_id,
            truck_name:           truck.truck_name,
            square_location_name: truck.square_location_name ?? null,
            square_linked:        false,
            revenue:              0,
            transactions:         0,
            error:                !truck.square_location_id ? 'Square not linked' : 'No Square token',
          })
          continue
        }
        console.log('[truck] calling Square for', truck.truck_name, 'location_id:', truck.square_location_id)
        const result = await squarePayments(token, truck.square_location_id, beginTime, endTime)
        console.log('[truck] result for', truck.truck_name, ':', JSON.stringify({ revenue: result.revenue, transactions: result.transactions, error: result.error }))

        if (!result.error && result.rawPayments.length > 0) {
          storePaymentData(supabase, result.rawPayments, vendorId, truck.truck_id, event_id, truck.square_location_id, eventTZ, token)
            .catch((e: any) => console.error('[store] unhandled error:', e.message))
        }
        truckResults.push({
          truck_id:             truck.truck_id,
          truck_name:           truck.truck_name,
          square_location_name: truck.square_location_name ?? null,
          square_linked:        true,
          revenue:              result.error ? null : result.revenue,
          transactions:         result.error ? null : result.transactions,
          error:                result.error,
        })
        if (!result.error) vendorTotal += result.revenue
      }

      const vendorResult = {
        vendor_id:           vendorId,
        business_name:       profile?.business_name ?? 'Vendor',
        square_connected:    profile?.square_connected ?? false,
        square_merchant_name: profile?.square_merchant_name ?? null,
        trucks:              truckResults,
        vendor_total:        vendorTotal,
      }
      vendorResults.push(vendorResult)
      eventTotal += vendorTotal

      // Cache snapshot for completed events
      if (isPast) {
        await supabase.from('event_vendor_revenue_snapshots').upsert(
          {
            event_id,
            vendor_id:   vendorId,
            snapshot:    vendorResult,
            captured_at: new Date().toISOString(),
          },
          { onConflict: 'event_id,vendor_id' },
        )
      }
    }

    return jsonRes({
      event_id,
      event_name:  event.name,
      is_past:     isPast,
      vendors:     vendorResults,
      event_total: eventTotal,
    })
  } catch (err: any) {
    console.error('[vendor-event-revenue] unhandled error:', err.message)
    return jsonRes({ error: err.message }, 500)
  }
})
