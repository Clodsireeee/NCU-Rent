-- CreateEnum
CREATE TYPE "PropertySource" AS ENUM ('USER', 'NCU_HOUSE', 'NEARBY_SCHOOL', 'FIRE_LIST');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PUBLISHED', 'PENDING', 'REJECTED');

-- CreateEnum
CREATE TYPE "EaterySource" AS ENUM ('USER', 'GOOGLE');

-- AlterTable
ALTER TABLE "Property" ALTER COLUMN "price" DROP NOT NULL,
ADD COLUMN     "priceMax" INTEGER,
ADD COLUMN     "source" "PropertySource" NOT NULL DEFAULT 'USER',
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "fireSafetyCertified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vacancy" INTEGER,
ADD COLUMN     "extra" JSONB,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "status" "ReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
ADD COLUMN     "moderationReason" TEXT,
ADD COLUMN     "moderationFlags" TEXT[];

-- AlterTable
ALTER TABLE "Eatery" ALTER COLUMN "name" DROP NOT NULL,
ADD COLUMN     "source" "EaterySource" NOT NULL DEFAULT 'USER',
ADD COLUMN     "googlePlaceId" TEXT,
ADD COLUMN     "syncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "EateryReview" ADD COLUMN     "status" "ReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
ADD COLUMN     "moderationReason" TEXT,
ADD COLUMN     "moderationFlags" TEXT[],
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "ReviewReport" (
    "id" SERIAL NOT NULL,
    "reason" TEXT NOT NULL,
    "reporterId" INTEGER NOT NULL,
    "reviewId" INTEGER,
    "eateryReviewId" INTEGER,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampusPost" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publisher" TEXT,
    "rawCategory" TEXT,
    "publishedAt" TIMESTAMP(3),
    "content" TEXT,
    "summary" TEXT,
    "tags" TEXT[],
    "taggedBy" TEXT,
    "eventStart" TIMESTAMP(3),
    "eventEnd" TIMESTAMP(3),
    "location" TEXT,
    "clubName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampusPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Club" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "nature" TEXT,
    "intro" TEXT,
    "url" TEXT NOT NULL,
    "links" TEXT[],
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Club_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Property_address_idx" ON "Property"("address");

-- CreateIndex
CREATE UNIQUE INDEX "Property_source_externalId_key" ON "Property"("source", "externalId");

-- CreateIndex
CREATE INDEX "Review_status_idx" ON "Review"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Eatery_googlePlaceId_key" ON "Eatery"("googlePlaceId");

-- CreateIndex
CREATE INDEX "EateryReview_status_idx" ON "EateryReview"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewReport_reporterId_reviewId_key" ON "ReviewReport"("reporterId", "reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewReport_reporterId_eateryReviewId_key" ON "ReviewReport"("reporterId", "eateryReviewId");

-- CreateIndex
CREATE UNIQUE INDEX "CampusPost_url_key" ON "CampusPost"("url");

-- CreateIndex
CREATE INDEX "CampusPost_publishedAt_idx" ON "CampusPost"("publishedAt");

-- CreateIndex
CREATE INDEX "CampusPost_tags_idx" ON "CampusPost" USING GIN ("tags");

-- CreateIndex
CREATE UNIQUE INDEX "Club_name_key" ON "Club"("name");

-- AddForeignKey
ALTER TABLE "ReviewReport" ADD CONSTRAINT "ReviewReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewReport" ADD CONSTRAINT "ReviewReport_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewReport" ADD CONSTRAINT "ReviewReport_eateryReviewId_fkey" FOREIGN KEY ("eateryReviewId") REFERENCES "EateryReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
