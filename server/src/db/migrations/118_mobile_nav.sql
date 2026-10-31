-- Which way the app navigates on a phone.
--
-- There has only ever been one: a rail of icons across the bottom that has to
-- scroll sideways once there are more than five or six sections, so the ones
-- at the end are found by swiping and remembering. That suits somebody who
-- lives in two or three sections all day.
--
-- It does not suit somebody who uses all of them. For them a menu that opens
-- with every section listed, in the same order as the desktop sidebar, is one
-- tap and a read rather than a swipe and a hunt — so it is a choice, made per
-- person when their account is set up.
--
--   rail  the bottom bar, as it has always been (the default)
--   menu  a hamburger that drops down, in desktop order

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mobile_nav VARCHAR(10) NOT NULL DEFAULT 'rail';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_mobile_nav_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_mobile_nav_check
      CHECK (mobile_nav IN ('rail', 'menu'));
  END IF;
END $$;

COMMENT ON COLUMN users.mobile_nav IS
  'rail | menu — how this person navigates on a phone. See migration 118.';
