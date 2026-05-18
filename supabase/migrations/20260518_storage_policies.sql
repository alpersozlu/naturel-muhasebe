-- Storage RLS policies for `uploads` bucket
-- Path convention: <storeId>/<dailyRecordId>/<type>/<filename>
-- The first path segment must be a store_id the user has access to.
--
-- Idempotent: safe to re-run.

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "uploads_select_admin" ON storage.objects;
DROP POLICY IF EXISTS "uploads_select_assigned" ON storage.objects;
DROP POLICY IF EXISTS "uploads_insert_admin" ON storage.objects;
DROP POLICY IF EXISTS "uploads_insert_assigned" ON storage.objects;
DROP POLICY IF EXISTS "uploads_update_admin" ON storage.objects;
DROP POLICY IF EXISTS "uploads_delete_admin" ON storage.objects;

-- SELECT: admin can read anything; others only files under store paths they're assigned to
CREATE POLICY "uploads_select_admin"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'uploads'
    AND EXISTS (SELECT 1 FROM public."User" WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "uploads_select_assigned"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] IN (
      SELECT store_id::text FROM public."UserStoreAccess" WHERE user_id = auth.uid()
    )
  );

-- INSERT: admin can write anything; others only under their assigned store paths
CREATE POLICY "uploads_insert_admin"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'uploads'
    AND EXISTS (SELECT 1 FROM public."User" WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "uploads_insert_assigned"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'uploads'
    AND (storage.foldername(name))[1] IN (
      SELECT store_id::text FROM public."UserStoreAccess" WHERE user_id = auth.uid()
    )
  );

-- UPDATE: admin only (overwrite / metadata change)
CREATE POLICY "uploads_update_admin"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'uploads'
    AND EXISTS (SELECT 1 FROM public."User" WHERE id = auth.uid() AND role = 'admin')
  );

-- DELETE: admin only
CREATE POLICY "uploads_delete_admin"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'uploads'
    AND EXISTS (SELECT 1 FROM public."User" WHERE id = auth.uid() AND role = 'admin')
  );
