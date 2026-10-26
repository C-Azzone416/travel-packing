CREATE TABLE "account_deletions" (
	"user_id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
