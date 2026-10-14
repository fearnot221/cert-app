-- PDF backgrounds keep a vector copy of their first page alongside the PNG preview.
ALTER TABLE "Asset" ADD COLUMN "vectorStorageKey" TEXT, ADD COLUMN "vectorSha256" TEXT;
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_vector_pair" CHECK (("vectorStorageKey" IS NULL) = ("vectorSha256" IS NULL));
