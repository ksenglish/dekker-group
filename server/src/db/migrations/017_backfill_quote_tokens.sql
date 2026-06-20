-- Backfill public_token for any quotes created before migration 007 ran
UPDATE quotes SET public_token = gen_random_uuid() WHERE public_token IS NULL;
