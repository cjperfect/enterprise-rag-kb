-- Nullable revision preserves legacy indexes until the document is reindexed.
ALTER TABLE "knowledge_document" ADD COLUMN IF NOT EXISTS "index_revision" TEXT;
-- Reconcile fields previously added via db push; also permits clean deployments
-- from the repository's initial migration without removing historical data.
ALTER TABLE "knowledge_document" ADD COLUMN IF NOT EXISTS "content" TEXT;
ALTER TABLE "knowledge_document" ADD COLUMN IF NOT EXISTS "parse_mode" VARCHAR(30);
ALTER TABLE "knowledge_document" ADD COLUMN IF NOT EXISTS "parse_pages" INTEGER;
ALTER TABLE "knowledge_document" ADD COLUMN IF NOT EXISTS "parse_ocr_pages" INTEGER;
ALTER TABLE "chat_conversation" ADD COLUMN IF NOT EXISTS "session_file" VARCHAR(255);
ALTER TABLE "chat_conversation" ADD COLUMN IF NOT EXISTS "leaf_entry_id" VARCHAR(255);
