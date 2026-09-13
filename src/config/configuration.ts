export interface AppConfig {
  env: string;
  port: number;
  publicUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  superAdminEmail: string;
  superAdminPassword: string;
  trialDays: number;
  graceDays: number;
  /** Whether this instance runs the scheduled workers. */
  workersEnabled: boolean;
  whatsapp: {
    verifyToken: string;
    appSecret: string;
    accessToken: string;
    apiVersion: string;
    graphBaseUrl: string;
    defaultPhoneNumberId: string;
  };
  storage: {
    provider: 'supabase' | 'none';
    supabaseUrl: string;
    supabaseServiceKey: string;
    bucket: string;
  };
  tiktok: {
    clientKey: string;
    clientSecret: string;
    redirectUri: string;
    apiBaseUrl: string;
  };
}

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export default (): AppConfig => ({
  env: process.env.NODE_ENV ?? 'development',
  port: int(process.env.PORT, 3000),
  publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:3000',
  jwtSecret: process.env.JWT_SECRET ?? 'change-me-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  superAdminEmail: process.env.SUPER_ADMIN_EMAIL ?? 'admin@aqar.network',
  superAdminPassword: process.env.SUPER_ADMIN_PASSWORD ?? 'change-me',
  // Three free months: the offer that gets a traditional office to try at all.
  trialDays: int(process.env.TRIAL_DAYS, 90),
  graceDays: int(process.env.GRACE_DAYS, 7),
  // The dispatcher, the draft finalizer and the subscription sweep. Off lets an
  // instance serve HTTP only - useful for a second replica, and it keeps tests
  // from having live cron jobs mutate the database underneath them.
  workersEnabled: process.env.WORKERS_ENABLED !== 'false',
  whatsapp: {
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? '',
    appSecret: process.env.WHATSAPP_APP_SECRET ?? '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? '',
    apiVersion: process.env.WHATSAPP_API_VERSION ?? 'v21.0',
    graphBaseUrl: process.env.WHATSAPP_GRAPH_BASE_URL ?? 'https://graph.facebook.com',
    defaultPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
  },
  storage: {
    provider: (process.env.STORAGE_PROVIDER as 'supabase' | 'none') ?? 'none',
    supabaseUrl: process.env.SUPABASE_URL ?? '',
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    bucket: process.env.SUPABASE_STORAGE_BUCKET ?? 'property-media',
  },
  tiktok: {
    clientKey: process.env.TIKTOK_CLIENT_KEY ?? '',
    clientSecret: process.env.TIKTOK_CLIENT_SECRET ?? '',
    redirectUri: process.env.TIKTOK_REDIRECT_URI ?? '',
    apiBaseUrl: process.env.TIKTOK_API_BASE_URL ?? 'https://open.tiktokapis.com',
  },
});
