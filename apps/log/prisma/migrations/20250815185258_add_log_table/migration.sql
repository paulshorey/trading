-- CreateTable
CREATE TABLE "public"."logs_v1" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" JSONB,
    "access_key" TEXT,
    "server_name" TEXT,
    "app_name" TEXT,
    "node_env" TEXT,
    "category" TEXT,
    "tag" TEXT,
    "time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logs_v1_pkey" PRIMARY KEY ("id")
);
