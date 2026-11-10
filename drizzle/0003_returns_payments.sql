CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_no" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"party_type" text NOT NULL,
	"party_id" uuid NOT NULL,
	"party_name" text NOT NULL,
	"kind" text NOT NULL,
	"direction" text NOT NULL,
	"method" text NOT NULL,
	"amount" bigint NOT NULL,
	"reference" text,
	"note" text,
	"ref_type" text,
	"ref_id" uuid,
	"user_id" text NOT NULL,
	"user_name" text NOT NULL,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"purchase_item_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name" text NOT NULL,
	"unit_name" text NOT NULL,
	"unit_factor" integer NOT NULL,
	"quantity" text NOT NULL,
	"base_qty" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_no" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"purchase_id" uuid NOT NULL,
	"purchase_no" text NOT NULL,
	"supplier_id" uuid,
	"supplier_name" text NOT NULL,
	"total" bigint NOT NULL,
	"payable_adjusted" bigint NOT NULL,
	"refund_received" bigint NOT NULL,
	"refund_method" text,
	"reason" text NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_return_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL,
	"sale_item_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name" text NOT NULL,
	"unit_name" text NOT NULL,
	"unit_factor" integer NOT NULL,
	"quantity" text NOT NULL,
	"base_qty" bigint NOT NULL,
	"amount" bigint NOT NULL,
	"cost" bigint NOT NULL,
	"condition" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_no" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"sale_id" uuid NOT NULL,
	"invoice_no" text NOT NULL,
	"customer_id" uuid,
	"customer_name" text NOT NULL,
	"total" bigint NOT NULL,
	"due_adjusted" bigint NOT NULL,
	"refund" bigint NOT NULL,
	"refund_method" text,
	"cost_restocked" bigint NOT NULL,
	"reason" text NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_return_id_purchase_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."purchase_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_purchase_item_id_purchase_items_id_fk" FOREIGN KEY ("purchase_item_id") REFERENCES "public"."purchase_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_return_id_sale_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sale_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_sale_item_id_sale_items_id_fk" FOREIGN KEY ("sale_item_id") REFERENCES "public"."sale_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_no_uq" ON "payments" USING btree ("payment_no");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idem_uq" ON "payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "payments_party_idx" ON "payments" USING btree ("party_type","party_id");--> statement-breakpoint
CREATE INDEX "payments_created_idx" ON "payments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "purchase_return_items_return_idx" ON "purchase_return_items" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "purchase_return_items_item_idx" ON "purchase_return_items" USING btree ("purchase_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_returns_no_uq" ON "purchase_returns" USING btree ("return_no");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_returns_idem_uq" ON "purchase_returns" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "purchase_returns_purchase_idx" ON "purchase_returns" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "sale_return_items_return_idx" ON "sale_return_items" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "sale_return_items_item_idx" ON "sale_return_items" USING btree ("sale_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_returns_no_uq" ON "sale_returns" USING btree ("return_no");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_returns_idem_uq" ON "sale_returns" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "sale_returns_sale_idx" ON "sale_returns" USING btree ("sale_id");