-- Who can see a Hub folder.
--
-- Every folder used to be open to every signed-in staff member. Some are not
-- for everyone — pay rates, the sales playbook, a supplier's trade pricing —
-- so a folder can now be limited to particular user groups (roles), particular
-- people, or both.
--
-- An unrestricted folder is open to everyone, as before. A restricted one is
-- open to admins, to anyone whose role is in access_roles, and to anyone whose
-- id is in access_user_ids. A restriction carries down: a folder inside a
-- restricted folder is only visible to someone who can see every folder above
-- it as well.

ALTER TABLE hub_folders
  ADD COLUMN IF NOT EXISTS restricted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE hub_folders
  ADD COLUMN IF NOT EXISTS access_roles TEXT[] NOT NULL DEFAULT '{}';

-- An array rather than a join table: there are tens of folders and a handful
-- of people on each, and a person who has left simply stops matching.
ALTER TABLE hub_folders
  ADD COLUMN IF NOT EXISTS access_user_ids UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN hub_folders.restricted IS
  'When true, only admins, access_roles and access_user_ids can see the folder '
  '(and everything in it). Inherited by subfolders. See migration 131.';
