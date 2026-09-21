-- AlterTable
ALTER TABLE "wallets" ADD COLUMN     "blockedItemIds" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "blockedKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[];

