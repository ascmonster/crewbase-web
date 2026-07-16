-- FWC award rate guidelines — web portal parity with mobile.
--
-- Adds the small set of columns the web portal reads/writes for award-rate
-- guidelines. Idempotent: safe to run whether or not the mobile backend has
-- already added these. The award data tables themselves (award_rates_live,
-- award_penalties_live, award_allowances_live) are owned/populated by the
-- backend sync and are intentionally NOT created here.

-- Vendor + promoter preference: show casual/permanent penalty-rate breakdowns.
alter table if exists public.vendor_profiles
  add column if not exists show_penalty_rates boolean not null default false;

alter table if exists public.promoter_profiles
  add column if not exists show_penalty_rates boolean not null default false;

-- Default Modern Award (MA code) selected for a payer's general pay rates.
alter table if exists public.pay_rates
  add column if not exists award_code text;
