-- Migration 081: a default quote description per document theme
--
-- Every new quote starts with its theme's description already in the box, and
-- products added from the Sales Presenter append their own description
-- underneath it. Rich text, same as the quote description field itself.
ALTER TABLE document_themes ADD COLUMN IF NOT EXISTS quote_description TEXT;
