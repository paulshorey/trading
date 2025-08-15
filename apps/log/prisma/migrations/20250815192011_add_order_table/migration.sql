-- CreateTable
CREATE TABLE "public"."orders_v1" (
    "id" SERIAL NOT NULL,
    "client_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "server_name" TEXT,
    "app_name" TEXT,
    "node_env" TEXT,
    "time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_v1_pkey" PRIMARY KEY ("id")
);
