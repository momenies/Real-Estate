-- CreateEnum
CREATE TYPE "OfficeStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PlanCode" AS ENUM ('TRIAL', 'BASIC', 'PRO');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'OFFICE_OWNER', 'OFFICE_AGENT');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED', 'SOLD');

-- CreateEnum
CREATE TYPE "DealType" AS ENUM ('SALE', 'RENT', 'INVESTMENT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('APARTMENT', 'VILLA', 'LAND', 'BUILDING', 'SHOP', 'OFFICE', 'FARM', 'CHALET', 'REST_HOUSE', 'OTHER');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO', 'DOCUMENT', 'AUDIO');

-- CreateEnum
CREATE TYPE "LeadIntent" AS ENUM ('BUY', 'RENT', 'SELL', 'LEASE_OUT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'ACTIVE', 'QUALIFIED', 'CLOSED', 'LOST');

-- CreateEnum
CREATE TYPE "ConversationActor" AS ENUM ('OWNER', 'LEAD');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "BroadcastStatus" AS ENUM ('DRAFT', 'QUEUED', 'SENDING', 'COMPLETED', 'CANCELED', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "SkipReason" AS ENUM ('ALREADY_RECEIVED_PROPERTY', 'DAILY_CAP_REACHED', 'COOLDOWN_ACTIVE', 'OPTED_OUT', 'QUIET_HOURS', 'OUTSIDE_24H_WINDOW', 'NO_MATCH', 'INVALID_NUMBER');

-- CreateEnum
CREATE TYPE "ExternalPlatform" AS ENUM ('TIKTOK', 'HARAJ', 'SNAPCHAT', 'INSTAGRAM', 'X');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('PREPARED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "offices" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "city" TEXT,
    "ownerName" TEXT,
    "status" "OfficeStatus" NOT NULL DEFAULT 'PENDING',
    "whatsappPhoneNumberId" TEXT,
    "whatsappDisplayNumber" TEXT,
    "wabaId" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Riyadh',
    "locale" TEXT NOT NULL DEFAULT 'ar',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "office_settings" (
    "id" UUID NOT NULL,
    "officeId" UUID NOT NULL,
    "dailyCapPerLead" INTEGER NOT NULL DEFAULT 1,
    "minHoursBetweenMessages" INTEGER NOT NULL DEFAULT 20,
    "quietHoursStart" INTEGER NOT NULL DEFAULT 22,
    "quietHoursEnd" INTEGER NOT NULL DEFAULT 8,
    "broadcastRatePerMinute" INTEGER NOT NULL DEFAULT 20,
    "autoSendLatestToNewLead" BOOLEAN NOT NULL DEFAULT true,
    "latestCount" INTEGER NOT NULL DEFAULT 3,
    "draftWindowMinutes" INTEGER NOT NULL DEFAULT 30,
    "defaultCity" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "office_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "officeId" UUID,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OFFICE_OWNER',
    "email" TEXT,
    "passwordHash" TEXT,
    "phone" TEXT,
    "waId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "officeId" UUID NOT NULL,
    "plan" "PlanCode" NOT NULL DEFAULT 'TRIAL',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "trialStartsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trialEndsAt" TIMESTAMP(3) NOT NULL,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "graceUntil" TIMESTAMP(3),
    "priceSar" INTEGER NOT NULL DEFAULT 0,
    "canceledAt" TIMESTAMP(3),
    "lastRemindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" UUID NOT NULL,
    "officeId" UUID NOT NULL,
    "createdById" UUID,
    "refCode" TEXT NOT NULL,
    "status" "PropertyStatus" NOT NULL DEFAULT 'DRAFT',
    "dealType" "DealType" NOT NULL DEFAULT 'UNKNOWN',
    "propertyType" "PropertyType" NOT NULL DEFAULT 'OTHER',
    "title" TEXT,
    "description" TEXT,
    "priceSar" INTEGER,
    "district" TEXT,
    "city" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "locationName" TEXT,
    "areaSqm" DOUBLE PRECISION,
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "floors" INTEGER,
    "ageYears" INTEGER,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rawText" TEXT,
    "publishedAt" TIMESTAMP(3),
    "draftExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_media" (
    "id" UUID NOT NULL,
    "officeId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "type" "MediaType" NOT NULL,
    "waMediaId" TEXT,
    "storageKey" TEXT,
    "url" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "caption" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "officeId" UUID NOT NULL,
    "waId" TEXT NOT NULL,
    "phone" TEXT,
    "name" TEXT,
    "intent" "LeadIntent" NOT NULL DEFAULT 'UNKNOWN',
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "propertyTypes" "PropertyType"[] DEFAULT ARRAY[]::"PropertyType"[],
    "districts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "city" TEXT,
    "budgetMin" INTEGER,
    "budgetMax" INTEGER,
    "notes" TEXT,
    "source" TEXT DEFAULT 'whatsapp',
    "lastSearchAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3),
    "lastBroadcastAt" TIMESTAMP(3),
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "optedOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "officeId" UUID NOT NULL,
    "waId" TEXT NOT NULL,
    "actor" "ConversationActor" NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'IDLE',
    "context" JSONB NOT NULL DEFAULT '{}',
    "leadId" UUID,
    "draftPropertyId" UUID,
    "serviceWindowExpiresAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "officeId" UUID NOT NULL,
    "waId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "waMessageId" TEXT,
    "type" TEXT NOT NULL,
    "body" TEXT,
    "payload" JSONB,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcasts" (
    "id" UUID NOT NULL,
    "officeId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "createdById" UUID,
    "status" "BroadcastStatus" NOT NULL DEFAULT 'DRAFT',
    "audienceWindowDays" INTEGER NOT NULL DEFAULT 30,
    "filters" JSONB,
    "matchLeadPreferences" BOOLEAN NOT NULL DEFAULT true,
    "message" TEXT,
    "totalTargeted" INTEGER NOT NULL DEFAULT 0,
    "totalSent" INTEGER NOT NULL DEFAULT 0,
    "totalSkipped" INTEGER NOT NULL DEFAULT 0,
    "totalFailed" INTEGER NOT NULL DEFAULT 0,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broadcast_recipients" (
    "id" UUID NOT NULL,
    "officeId" UUID NOT NULL,
    "broadcastId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "skipReason" "SkipReason",
    "waMessageId" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcast_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_deliveries" (
    "id" UUID NOT NULL,
    "officeId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "broadcastId" UUID,
    "channel" TEXT NOT NULL DEFAULT 'broadcast',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_daily_quotas" (
    "id" UUID NOT NULL,
    "officeId" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "day" TEXT NOT NULL,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_daily_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_accounts" (
    "id" UUID NOT NULL,
    "officeId" UUID NOT NULL,
    "platform" "ExternalPlatform" NOT NULL,
    "externalUserId" TEXT,
    "displayName" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_publications" (
    "id" UUID NOT NULL,
    "officeId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "accountId" UUID,
    "platform" "ExternalPlatform" NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'PREPARED',
    "externalPostId" TEXT,
    "url" TEXT,
    "caption" TEXT,
    "payload" JSONB,
    "error" TEXT,
    "shareToken" TEXT,
    "shareExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "external_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "officeId" UUID,
    "actorUserId" UUID,
    "actorType" TEXT NOT NULL DEFAULT 'system',
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "offices_slug_key" ON "offices"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "offices_whatsappPhoneNumberId_key" ON "offices"("whatsappPhoneNumberId");

-- CreateIndex
CREATE INDEX "offices_status_idx" ON "offices"("status");

-- CreateIndex
CREATE UNIQUE INDEX "office_settings_officeId_key" ON "office_settings"("officeId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_waId_idx" ON "users"("waId");

-- CreateIndex
CREATE UNIQUE INDEX "users_officeId_waId_key" ON "users"("officeId", "waId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_officeId_key" ON "subscriptions"("officeId");

-- CreateIndex
CREATE INDEX "subscriptions_status_trialEndsAt_idx" ON "subscriptions"("status", "trialEndsAt");

-- CreateIndex
CREATE INDEX "subscription_events_subscriptionId_createdAt_idx" ON "subscription_events"("subscriptionId", "createdAt");

-- CreateIndex
CREATE INDEX "properties_officeId_status_createdAt_idx" ON "properties"("officeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "properties_officeId_district_idx" ON "properties"("officeId", "district");

-- CreateIndex
CREATE INDEX "properties_officeId_propertyType_dealType_idx" ON "properties"("officeId", "propertyType", "dealType");

-- CreateIndex
CREATE UNIQUE INDEX "properties_officeId_refCode_key" ON "properties"("officeId", "refCode");

-- CreateIndex
CREATE INDEX "property_media_propertyId_sortOrder_idx" ON "property_media"("propertyId", "sortOrder");

-- CreateIndex
CREATE INDEX "property_media_officeId_idx" ON "property_media"("officeId");

-- CreateIndex
CREATE INDEX "leads_officeId_lastSearchAt_idx" ON "leads"("officeId", "lastSearchAt");

-- CreateIndex
CREATE INDEX "leads_officeId_status_idx" ON "leads"("officeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "leads_officeId_waId_key" ON "leads"("officeId", "waId");

-- CreateIndex
CREATE INDEX "conversations_officeId_state_idx" ON "conversations"("officeId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_officeId_waId_key" ON "conversations"("officeId", "waId");

-- CreateIndex
CREATE UNIQUE INDEX "messages_waMessageId_key" ON "messages"("waMessageId");

-- CreateIndex
CREATE INDEX "messages_officeId_waId_createdAt_idx" ON "messages"("officeId", "waId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_externalId_key" ON "webhook_events"("provider", "externalId");

-- CreateIndex
CREATE INDEX "broadcasts_officeId_status_idx" ON "broadcasts"("officeId", "status");

-- CreateIndex
CREATE INDEX "broadcast_recipients_status_createdAt_idx" ON "broadcast_recipients"("status", "createdAt");

-- CreateIndex
CREATE INDEX "broadcast_recipients_officeId_status_idx" ON "broadcast_recipients"("officeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "broadcast_recipients_broadcastId_leadId_key" ON "broadcast_recipients"("broadcastId", "leadId");

-- CreateIndex
CREATE INDEX "property_deliveries_officeId_leadId_sentAt_idx" ON "property_deliveries"("officeId", "leadId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "property_deliveries_propertyId_leadId_key" ON "property_deliveries"("propertyId", "leadId");

-- CreateIndex
CREATE INDEX "lead_daily_quotas_officeId_day_idx" ON "lead_daily_quotas"("officeId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "lead_daily_quotas_leadId_day_key" ON "lead_daily_quotas"("leadId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "external_accounts_officeId_platform_key" ON "external_accounts"("officeId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "external_publications_shareToken_key" ON "external_publications"("shareToken");

-- CreateIndex
CREATE INDEX "external_publications_officeId_platform_status_idx" ON "external_publications"("officeId", "platform", "status");

-- CreateIndex
CREATE INDEX "audit_logs_officeId_createdAt_idx" ON "audit_logs"("officeId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "office_settings" ADD CONSTRAINT "office_settings_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_media" ADD CONSTRAINT "property_media_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_media" ADD CONSTRAINT "property_media_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_deliveries" ADD CONSTRAINT "property_deliveries_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_deliveries" ADD CONSTRAINT "property_deliveries_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_deliveries" ADD CONSTRAINT "property_deliveries_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_deliveries" ADD CONSTRAINT "property_deliveries_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "broadcasts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_daily_quotas" ADD CONSTRAINT "lead_daily_quotas_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_daily_quotas" ADD CONSTRAINT "lead_daily_quotas_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_accounts" ADD CONSTRAINT "external_accounts_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_publications" ADD CONSTRAINT "external_publications_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_publications" ADD CONSTRAINT "external_publications_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_publications" ADD CONSTRAINT "external_publications_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "external_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
