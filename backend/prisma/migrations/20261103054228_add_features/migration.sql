-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('RENT', 'SUBLET', 'SHORT_TERM');

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "availableFrom" TIMESTAMP(3),
ADD COLUMN     "availableTo" TIMESTAMP(3),
ADD COLUMN     "listingType" "ListingType" NOT NULL DEFAULT 'RENT';

-- CreateTable
CREATE TABLE "GarbageStop" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "days" INTEGER[],
    "arrivalTime" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "GarbageStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Eatery" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "category" TEXT NOT NULL,
    "priceRange" INTEGER,
    "description" TEXT,
    "ownerId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Eatery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EateryReview" (
    "id" SERIAL NOT NULL,
    "rating" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "eateryId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EateryReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Eatery_lat_lng_idx" ON "Eatery"("lat", "lng");

-- CreateIndex
CREATE UNIQUE INDEX "EateryReview_userId_eateryId_key" ON "EateryReview"("userId", "eateryId");

-- AddForeignKey
ALTER TABLE "Eatery" ADD CONSTRAINT "Eatery_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EateryReview" ADD CONSTRAINT "EateryReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EateryReview" ADD CONSTRAINT "EateryReview_eateryId_fkey" FOREIGN KEY ("eateryId") REFERENCES "Eatery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
