-- ============================================================
-- Crewbase Web Portal — RLS Migration
-- Run this in the Supabase SQL Editor
-- ============================================================

-- ── event_vendors ─────────────────────────────────────────
ALTER TABLE event_vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promoter_select_event_vendors" ON event_vendors;
CREATE POLICY "promoter_select_event_vendors" ON event_vendors
  FOR SELECT USING (
    event_id IN (SELECT id FROM events WHERE promoter_id = auth.uid())
  );

DROP POLICY IF EXISTS "promoter_insert_event_vendors" ON event_vendors;
CREATE POLICY "promoter_insert_event_vendors" ON event_vendors
  FOR INSERT WITH CHECK (
    event_id IN (SELECT id FROM events WHERE promoter_id = auth.uid())
  );

DROP POLICY IF EXISTS "promoter_delete_event_vendors" ON event_vendors;
CREATE POLICY "promoter_delete_event_vendors" ON event_vendors
  FOR DELETE USING (
    event_id IN (SELECT id FROM events WHERE promoter_id = auth.uid())
  );

-- ── event_staff ───────────────────────────────────────────
ALTER TABLE event_staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promoter_select_event_staff" ON event_staff;
CREATE POLICY "promoter_select_event_staff" ON event_staff
  FOR SELECT USING (
    event_id IN (SELECT id FROM events WHERE promoter_id = auth.uid())
  );

DROP POLICY IF EXISTS "promoter_insert_event_staff" ON event_staff;
CREATE POLICY "promoter_insert_event_staff" ON event_staff
  FOR INSERT WITH CHECK (
    event_id IN (SELECT id FROM events WHERE promoter_id = auth.uid())
  );

DROP POLICY IF EXISTS "promoter_delete_event_staff" ON event_staff;
CREATE POLICY "promoter_delete_event_staff" ON event_staff
  FOR DELETE USING (
    event_id IN (SELECT id FROM events WHERE promoter_id = auth.uid())
  );

-- ── broadcasts ────────────────────────────────────────────
ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promoter_select_broadcasts" ON broadcasts;
CREATE POLICY "promoter_select_broadcasts" ON broadcasts
  FOR SELECT USING (
    event_id IN (SELECT id FROM events WHERE promoter_id = auth.uid())
  );

DROP POLICY IF EXISTS "promoter_insert_broadcasts" ON broadcasts;
CREATE POLICY "promoter_insert_broadcasts" ON broadcasts
  FOR INSERT WITH CHECK (
    event_id IN (SELECT id FROM events WHERE promoter_id = auth.uid())
    AND sender_id = auth.uid()
  );

-- ── event_documents ───────────────────────────────────────
ALTER TABLE event_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promoter_select_event_documents" ON event_documents;
CREATE POLICY "promoter_select_event_documents" ON event_documents
  FOR SELECT USING (
    event_id IN (SELECT id FROM events WHERE promoter_id = auth.uid())
  );

DROP POLICY IF EXISTS "promoter_insert_event_documents" ON event_documents;
CREATE POLICY "promoter_insert_event_documents" ON event_documents
  FOR INSERT WITH CHECK (
    event_id IN (SELECT id FROM events WHERE promoter_id = auth.uid())
  );

-- ── shifts ────────────────────────────────────────────────
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promoter_select_shifts" ON shifts;
CREATE POLICY "promoter_select_shifts" ON shifts
  FOR SELECT USING (promoter_id = auth.uid());

DROP POLICY IF EXISTS "promoter_update_shifts" ON shifts;
CREATE POLICY "promoter_update_shifts" ON shifts
  FOR UPDATE USING (promoter_id = auth.uid());

-- ── promoter_staff ────────────────────────────────────────
ALTER TABLE promoter_staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promoter_select_promoter_staff" ON promoter_staff;
CREATE POLICY "promoter_select_promoter_staff" ON promoter_staff
  FOR SELECT USING (promoter_id = auth.uid());

DROP POLICY IF EXISTS "promoter_insert_promoter_staff" ON promoter_staff;
CREATE POLICY "promoter_insert_promoter_staff" ON promoter_staff
  FOR INSERT WITH CHECK (promoter_id = auth.uid());

DROP POLICY IF EXISTS "promoter_delete_promoter_staff" ON promoter_staff;
CREATE POLICY "promoter_delete_promoter_staff" ON promoter_staff
  FOR DELETE USING (promoter_id = auth.uid());

-- ── vendor_profiles ───────────────────────────────────────
ALTER TABLE vendor_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promoter_select_vendor_profiles" ON vendor_profiles;
CREATE POLICY "promoter_select_vendor_profiles" ON vendor_profiles
  FOR SELECT USING (
    id IN (
      SELECT ev.vendor_id FROM event_vendors ev
      JOIN events e ON e.id = ev.event_id
      WHERE e.promoter_id = auth.uid()
    )
  );

-- ── truck_profiles ────────────────────────────────────────
ALTER TABLE truck_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promoter_select_truck_profiles" ON truck_profiles;
CREATE POLICY "promoter_select_truck_profiles" ON truck_profiles
  FOR SELECT USING (
    vendor_id IN (
      SELECT vp.id FROM vendor_profiles vp
      JOIN event_vendors ev ON ev.vendor_id = vp.id
      JOIN events e ON e.id = ev.event_id
      WHERE e.promoter_id = auth.uid()
    )
  );

-- ── user_ratings_summary ──────────────────────────────────
-- If this is a VIEW, RLS is controlled by the underlying tables.
-- If it is a TABLE, enable RLS below:
ALTER TABLE user_ratings_summary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promoter_select_ratings" ON user_ratings_summary;
CREATE POLICY "promoter_select_ratings" ON user_ratings_summary
  FOR SELECT USING (true);

-- ── users (allow searching for gate staff / invite) ───────
-- Only adds a SELECT policy for authenticated users.
-- Adjust if you already have a users policy.
DROP POLICY IF EXISTS "authenticated_read_users" ON users;
CREATE POLICY "authenticated_read_users" ON users
  FOR SELECT USING (auth.role() = 'authenticated');
