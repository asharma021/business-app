import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    setupFiles: ["tests/integration/setup.ts"],
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://radar:radar@localhost:5432/radar_test",
      AUTH_SECRET: "test-secret-test-secret-test-secret-123",
      ALLOWED_EMAILS: "owner@example.com",
      APP_URL: "http://localhost:3000",
    },
  },
});
