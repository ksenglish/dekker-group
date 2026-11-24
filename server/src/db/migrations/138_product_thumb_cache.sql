-- Keep the thumbnail that was made, instead of making it again every time.
--
-- /products/:id/thumb decoded the product's picture and re-encoded it on every
-- single request. A price list grid asks for forty at once, and a photo off a
-- phone is about 48MB once it is pixels rather than a JPEG — small as a file,
-- enormous as a bitmap. libvips allocates those outside the heap, frees them,
-- and glibc hangs on to the space in its per-thread arenas rather than giving
-- it back. So the instance sat at 455MB of its 512MB with 52MB of heap and
-- nothing in flight: not memory being used, memory being held.
--
-- A thumbnail is the same few kilobytes every time it is made. Making it once
-- and keeping it takes the decoding out of the request path altogether.
--
-- media_thumb_of records which picture it was made from — the object key, or
-- the length of an inline image. Replacing a product's picture writes a new
-- key, so the thumbnail stops matching and is made again. That was the reason
-- it was never stored in the first place; this is the answer to it.
ALTER TABLE products ADD COLUMN IF NOT EXISTS media_thumb TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS media_thumb_of TEXT;

COMMENT ON COLUMN products.media_thumb IS
  'A 400px WebP of this product''s picture, base64. Made on the first request '
  'for it and kept. See migration 138.';
COMMENT ON COLUMN products.media_thumb_of IS
  'Which picture the thumbnail was made from: the media_key, or inline:<length> '
  'for one stored in the row. A thumbnail that does not match the picture is '
  'made again rather than served. See migration 138.';
