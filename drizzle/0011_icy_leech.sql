CREATE TABLE "account_deletions" (
	"user_id" text PRIMARY KEY NOT NULL,
	"identity_created_at" timestamp with time zone NOT NULL,
	"setup_email_digest" text NOT NULL
);
