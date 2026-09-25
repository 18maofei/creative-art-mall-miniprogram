ALTER TABLE artworks ADD COLUMN kind TEXT NOT NULL DEFAULT 'ARTWORK' CHECK (kind IN ('ARTWORK', 'MOMENT'));
CREATE INDEX IF NOT EXISTS idx_artworks_kind_public ON artworks(kind, is_public);
