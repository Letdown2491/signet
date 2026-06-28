-- AlterTable: add optional client-supplied avatar URL for connected apps.
-- Untrusted (NIP-46 connect metadata); only ever served via the SSRF-guarded avatar proxy.
ALTER TABLE "KeyUser" ADD COLUMN "imageUrl" TEXT;
