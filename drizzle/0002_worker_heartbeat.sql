CREATE TABLE "worker_heartbeat" (
	"id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp NOT NULL,
	"last_beat_at" timestamp NOT NULL,
	"host" text
);
