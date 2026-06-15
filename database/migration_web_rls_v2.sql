-- ============================================================
-- Crewbase Web Portal — RLS Migration v2
-- Run this in the Supabase SQL Editor after migration_web_rls.sql
-- ============================================================

-- ── event_broadcasts ──────────────────────────────────────
ALTER TABLE event_broadcasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promoter_select_event_broadcasts" ON event_broadcasts;
CREATE POLICY "promoter_select_event_broadcasts" ON event_broadcasts
  FOR SELECT USING (
    promoter_id = auth.uid()
  );

DROP POLICY IF EXISTS "promoter_insert_event_broadcasts" ON event_broadcasts;
CREATE POLICY "promoter_insert_event_broadcasts" ON event_broadcasts
  FOR INSERT WITH CHECK (
    promoter_id = auth.uid()
  );

-- ── event_staff ───────────────────────────────────────────
-- (table already enabled in v1; adding missing policies here)

DROP POLICY IF EXISTS "promoter_update_event_staff" ON event_staff;
CREATE POLICY "promoter_update_event_staff" ON event_staff
  FOR UPDATE USING (
    event_id IN (SELECT id FROM events WHERE promoter_id = auth.uid())
  );

-- ── schedules ─────────────────────────────────────────────
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vendor_select_schedules" ON schedules;
CREATE POLICY "vendor_select_schedules" ON schedules
  FOR SELECT USING (
    vendor_id = auth.uid()
  );

DROP POLICY IF EXISTS "vendor_insert_schedules" ON schedules;
CREATE POLICY "vendor_insert_schedules" ON schedules
  FOR INSERT WITH CHECK (
    vendor_id = auth.uid()
  );

DROP POLICY IF EXISTS "vendor_update_schedules" ON schedules;
CREATE POLICY "vendor_update_schedules" ON schedules
  FOR UPDATE USING (
    vendor_id = auth.uid()
  );

DROP POLICY IF EXISTS "vendor_delete_schedules" ON schedules;
CREATE POLICY "vendor_delete_schedules" ON schedules
  FOR DELETE USING (
    vendor_id = auth.uid()
  );

-- ── job_listings ──────────────────────────────────────────
ALTER TABLE job_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promoter_select_job_listings" ON job_listings;
CREATE POLICY "promoter_select_job_listings" ON job_listings
  FOR SELECT USING (
    promoter_id = auth.uid()
  );

DROP POLICY IF EXISTS "staff_select_active_job_listings" ON job_listings;
CREATE POLICY "staff_select_active_job_listings" ON job_listings
  FOR SELECT USING (
    status = 'active'
  );

DROP POLICY IF EXISTS "promoter_insert_job_listings" ON job_listings;
CREATE POLICY "promoter_insert_job_listings" ON job_listings
  FOR INSERT WITH CHECK (
    promoter_id = auth.uid()
  );

DROP POLICY IF EXISTS "promoter_update_job_listings" ON job_listings;
CREATE POLICY "promoter_update_job_listings" ON job_listings
  FOR UPDATE USING (
    promoter_id = auth.uid()
  );

-- ── job_applications ──────────────────────────────────────
ALTER TABLE job_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promoter_select_job_applications" ON job_applications;
CREATE POLICY "promoter_select_job_applications" ON job_applications
  FOR SELECT USING (
    job_id IN (
      SELECT id FROM job_listings WHERE promoter_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "staff_select_own_applications" ON job_applications;
CREATE POLICY "staff_select_own_applications" ON job_applications
  FOR SELECT USING (
    staff_id = auth.uid()
  );

DROP POLICY IF EXISTS "staff_insert_job_applications" ON job_applications;
CREATE POLICY "staff_insert_job_applications" ON job_applications
  FOR INSERT WITH CHECK (
    staff_id = auth.uid()
  );

DROP POLICY IF EXISTS "promoter_update_job_applications" ON job_applications;
CREATE POLICY "promoter_update_job_applications" ON job_applications
  FOR UPDATE USING (
    job_id IN (
      SELECT id FROM job_listings WHERE promoter_id = auth.uid()
    )
  );

-- ── staff_profiles ────────────────────────────────────────
ALTER TABLE staff_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_select_staff_profiles" ON staff_profiles;
CREATE POLICY "authenticated_select_staff_profiles" ON staff_profiles
  FOR SELECT USING (
    auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "staff_manage_own_profile" ON staff_profiles;
CREATE POLICY "staff_manage_own_profile" ON staff_profiles
  FOR ALL USING (
    user_id = auth.uid()
  );

-- ── vendor_profiles ───────────────────────────────────────
ALTER TABLE vendor_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_select_vendor_profiles" ON vendor_profiles;
CREATE POLICY "authenticated_select_vendor_profiles" ON vendor_profiles
  FOR SELECT USING (
    auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "vendor_manage_own_profile" ON vendor_profiles;
CREATE POLICY "vendor_manage_own_profile" ON vendor_profiles
  FOR ALL USING (
    user_id = auth.uid()
  );

-- ── promoter_profiles ─────────────────────────────────────
ALTER TABLE promoter_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promoter_select_own_profile" ON promoter_profiles;
CREATE POLICY "promoter_select_own_profile" ON promoter_profiles
  FOR SELECT USING (
    user_id = auth.uid()
  );

DROP POLICY IF EXISTS "promoter_manage_own_profile" ON promoter_profiles;
CREATE POLICY "promoter_manage_own_profile" ON promoter_profiles
  FOR ALL USING (
    user_id = auth.uid()
  );

-- ── ratings ───────────────────────────────────────────────
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_select_ratings" ON ratings;
CREATE POLICY "authenticated_select_ratings" ON ratings
  FOR SELECT USING (
    auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "rater_insert_ratings" ON ratings;
CREATE POLICY "rater_insert_ratings" ON ratings
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated'
  );

-- user_ratings_summary is a VIEW — no RLS needed; it inherits from ratings
