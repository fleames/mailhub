import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .default("postgres://mailhub:mailhub@localhost:5448/mailhub"),
  APP_URL: z.string().default("http://localhost:3480"),
  APP_PASSWORD: z.string().min(1, "APP_PASSWORD is required"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 chars"),
  INBOUND_SECRET: z.string().min(16, "INBOUND_SECRET must be at least 16 chars"),

  // Outbound (can also be overridden in Settings)
  RESEND_API_KEY: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),

  // Attachment/raw storage: R2 if configured, local disk otherwise
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  STORAGE_DIR: z.string().default("./data/storage"),

  // AI provider (OpenAI-compatible; DeepSeek by default)
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.string().default("https://api.deepseek.com"),
  AI_MODEL: z.string().default("deepseek-chat"),

  UNDO_SEND_SECONDS: z.coerce.number().default(15),
});

function validateEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${issues}`);
  }
  return parsed.data;
}

export const env = validateEnv();
