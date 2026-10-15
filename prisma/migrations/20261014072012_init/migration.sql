-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('ADMINISTRATOR', 'PROCESSOR');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'PROCESSING', 'READY_FOR_PICKUP', 'RELEASED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HistoryEventType" AS ENUM ('STATUS_CHANGED', 'RELEASE_DATE_CHANGED');

-- CreateTable
CREATE TABLE "staff_users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(80) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "StaffRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "staff_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_sessions" (
    "id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "csrf_token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_types" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_type_versions" (
    "id" UUID NOT NULL,
    "document_type_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "requirements" JSONB NOT NULL,
    "field_definitions" JSONB NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_type_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_requests" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(32) NOT NULL,
    "tracking_secret_hash" CHAR(64) NOT NULL,
    "document_type_version_id" UUID NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "full_name" VARCHAR(160) NOT NULL,
    "contact_number" VARCHAR(40) NOT NULL,
    "address" VARCHAR(500) NOT NULL,
    "applicant_fields" JSONB NOT NULL DEFAULT '{}',
    "expected_release_date" DATE,
    "ready_at" TIMESTAMPTZ(6),
    "released_at" TIMESTAMPTZ(6),
    "public_status_message" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_status_history" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "event_type" "HistoryEventType" NOT NULL,
    "from_status" "RequestStatus",
    "to_status" "RequestStatus",
    "old_release_date" DATE,
    "new_release_date" DATE,
    "public_message" VARCHAR(1000),
    "reason" VARCHAR(1000),
    "internal_note" VARCHAR(2000),
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "target_type" VARCHAR(100) NOT NULL,
    "target_id" VARCHAR(100),
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_idempotency" (
    "id" UUID NOT NULL,
    "key_hash" CHAR(64) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "request_id" UUID NOT NULL,
    "encrypted_response" TEXT NOT NULL,
    "response_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_idempotency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_users_username_key" ON "staff_users"("username");

-- CreateIndex
CREATE INDEX "staff_users_role_is_active_idx" ON "staff_users"("role", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "staff_sessions_token_hash_key" ON "staff_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "staff_sessions_staff_user_id_expires_at_idx" ON "staff_sessions"("staff_user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "document_types_slug_key" ON "document_types"("slug");

-- CreateIndex
CREATE INDEX "document_types_is_active_updated_at_idx" ON "document_types"("is_active", "updated_at");

-- CreateIndex
CREATE INDEX "document_type_versions_document_type_id_created_at_idx" ON "document_type_versions"("document_type_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "document_type_versions_document_type_id_version_key" ON "document_type_versions"("document_type_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "document_requests_reference_key" ON "document_requests"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "document_requests_tracking_secret_hash_key" ON "document_requests"("tracking_secret_hash");

-- CreateIndex
CREATE INDEX "document_requests_status_created_at_id_idx" ON "document_requests"("status", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "document_requests_expected_release_date_status_idx" ON "document_requests"("expected_release_date", "status");

-- CreateIndex
CREATE INDEX "document_requests_document_type_version_id_created_at_idx" ON "document_requests"("document_type_version_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "document_requests_full_name_idx" ON "document_requests"("full_name");

-- CreateIndex
CREATE INDEX "document_requests_contact_number_idx" ON "document_requests"("contact_number");

-- CreateIndex
CREATE INDEX "request_status_history_request_id_created_at_id_idx" ON "request_status_history"("request_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "audit_events_created_at_id_idx" ON "audit_events"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "audit_events_actor_id_created_at_idx" ON "audit_events"("actor_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_target_type_target_id_created_at_idx" ON "audit_events"("target_type", "target_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "submission_idempotency_key_hash_key" ON "submission_idempotency"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "submission_idempotency_request_id_key" ON "submission_idempotency"("request_id");

-- CreateIndex
CREATE INDEX "submission_idempotency_response_expires_at_idx" ON "submission_idempotency"("response_expires_at");

-- AddForeignKey
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_type_versions" ADD CONSTRAINT "document_type_versions_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "document_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_type_versions" ADD CONSTRAINT "document_type_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_document_type_version_id_fkey" FOREIGN KEY ("document_type_version_id") REFERENCES "document_type_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "document_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_status_history" ADD CONSTRAINT "request_status_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_idempotency" ADD CONSTRAINT "submission_idempotency_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "document_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
