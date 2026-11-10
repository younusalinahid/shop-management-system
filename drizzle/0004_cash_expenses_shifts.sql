CREATE TABLE "cash_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_no" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"category" text NOT NULL,
	"amount" bigint NOT NULL,
	"method" text NOT NULL,
	"expense_date" date NOT NULL,
	"description" text,
	"status" text NOT NULL,
	"void_reason" text,
	"user_id" text NOT NULL,
	"user_name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text NOT NULL,
	"status" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"opening_cash" bigint NOT NULL,
	"closed_at" timestamp with time zone,
	"expected_cash" bigint,
	"counted_cash" bigint,
	"difference" bigint,
	"note" text
);
--> statement-breakpoint
CREATE INDEX "cash_movements_created_idx" ON "cash_movements" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_no_uq" ON "expenses" USING btree ("expense_no");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_idem_uq" ON "expenses" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("expense_date");--> statement-breakpoint
CREATE INDEX "shifts_user_idx" ON "shifts" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "shifts_opened_idx" ON "shifts" USING btree ("opened_at");