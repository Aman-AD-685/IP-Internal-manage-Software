-- Similar ticket search indexes (run once in Supabase SQL Editor)
-- Enables faster title/description matching for GET /tickets/similar

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram index on title (speeds ILIKE / similarity on title)
CREATE INDEX IF NOT EXISTS idx_tickets_title_trgm
  ON public.tickets USING gin (title gin_trgm_ops);

-- Optional: trigram on first 500 chars of description (expression index)
CREATE INDEX IF NOT EXISTS idx_tickets_description_trgm
  ON public.tickets USING gin (left(COALESCE(description, ''), 500) gin_trgm_ops);

-- Full-text search index (optional, for future ts_rank queries)
CREATE INDEX IF NOT EXISTS idx_tickets_title_fts
  ON public.tickets USING gin (to_tsvector('english', COALESCE(title, '')));

NOTIFY pgrst, 'reload schema';

-- Verify (optional):
-- SELECT reference_no, title, similarity(title, 'GRN creation') AS score
-- FROM tickets
-- WHERE similarity(title, 'GRN creation') > 0.3
-- ORDER BY score DESC
-- LIMIT 10;
