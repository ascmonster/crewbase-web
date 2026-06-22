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

    const {
      event_id,
      vendor_id,
      truck_id,
      items,
      total_cents,
      square_location_id,
      device_id,
    } = await req.json()

    if (!event_id)           return jsonRes({ error: 'event_id required' }, 400)
    if (!vendor_id)          return jsonRes({ error: 'vendor_id required' }, 400)
    if (!total_cents)        return jsonRes({ error: 'total_cents required' }, 400)
    if (!square_location_id) return jsonRes({ error: 'square_location_id required' }, 400)
    if (!device_id)          return jsonRes({ error: 'device_id required' }, 400)

    // 1. Vendor's Square access token
    const { data: vendorProfile, error: vpErr } = await supabase
      .from('vendor_profiles')
      .select('square_access_token')
      .eq('user_id', vendor_id)
      .single()

    if (vpErr || !vendorProfile?.square_access_token) {
      return jsonRes({ error: 'Vendor Square not connected' }, 404)
    }

    // 2. Vendor's category for this event (needed to look up split)
    const { data: evVendor } = await supabase
      .from('event_vendors')
      .select('category')
      .eq('event_id', event_id)
      .eq('vendor_id', vendor_id)
      .maybeSingle()

    const vendorCategory: string | null = evVendor?.category ?? null

    // 3. Promoter's percentage for this vendor's category
    let promoterPercentage = 0
    if (vendorCategory) {
      const { data: split } = await supabase
        .from('event_category_splits')
        .select('promoter_percentage')
        .eq('event_id', event_id)
        .eq('category', vendorCategory)
        .maybeSingle()

      if (split?.promoter_percentage != null) {
        promoterPercentage = Number(split.promoter_percentage)
      }
    }

    // 4. Promoter's Square merchant ID from their event config
    const { data: sqCfg, error: sqCfgErr } = await supabase
      .from('event_square_config')
      .select('square_merchant_id')
      .eq('event_id', event_id)
      .single()

    if (sqCfgErr || !sqCfg?.square_merchant_id) {
      return jsonRes({ error: 'Promoter Square not configured for this event' }, 404)
    }

    // 5. App fee = promoter's share of the sale
    const appFeeCents = Math.round(total_cents * promoterPercentage / 100)

    console.log(
      '[terminal] event:', event_id,
      '| vendor:', vendor_id,
      '| category:', vendorCategory,
      '| promoter %:', promoterPercentage,
      '| total:', total_cents,
      '| app_fee:', appFeeCents,
    )

    // 6. Create Square Terminal Checkout
    const sqPayload = {
      idempotency_key: crypto.randomUUID(),
      checkout: {
        amount_money:   { amount: total_cents, currency: 'AUD' },
        ...(appFeeCents > 0 && { app_fee_money: { amount: appFeeCents, currency: 'AUD' } }),
        device_options: { device_id },
        reference_id:   `${event_id}-${vendor_id}`,
        note:           'Crewbase Event Payment',
      },
    }

    const sqRes = await fetch(`${squareApiBase()}/terminals/checkouts`, {
      method: 'POST',
      headers: {
        Authorization:    `Bearer ${vendorProfile.square_access_token}`,
        'Square-Version': SQ_VERSION,
        'Content-Type':   'application/json',
      },
      body: JSON.stringify(sqPayload),
    })

    const rawBody = await sqRes.text()

    if (!sqRes.ok) {
      console.error('[terminal] Square error:', sqRes.status, rawBody)
      return jsonRes({ error: `Square API error: ${rawBody}` }, 502)
    }

    const sqData = JSON.parse(rawBody)
    const checkoutId: string = sqData.checkout?.id

    if (!checkoutId) {
      console.error('[terminal] no checkout id in response:', rawBody)
      return jsonRes({ error: 'No checkout ID in Square response' }, 502)
    }

    // 7. Save pending transaction
    const { error: txErr } = await supabase
      .from('square_transactions')
      .insert({
        transaction_id:    checkoutId,
        vendor_id,
        truck_id:          truck_id ?? null,
        event_id,
        location_id:       square_location_id,
        amount_cents:      total_cents,
        net_amount_cents:  total_cents - appFeeCents,
        currency:          'AUD',
        payment_method:    'CARD_PRESENT',
        square_created_at: new Date().toISOString(),
      })

    if (txErr) {
      console.error('[terminal] failed to save transaction:', txErr.message)
    }

    return jsonRes({ success: true, checkout_id: checkoutId })
  } catch (err: any) {
    console.error('[create-terminal-checkout] unhandled error:', err.message)
    return jsonRes({ error: err.message }, 500)
  }
})
