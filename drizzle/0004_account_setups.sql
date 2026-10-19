CREATE TABLE "account_setups" (
	"email_digest" text PRIMARY KEY NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
