// Integration fixtures exercise local HTTP/database flows, never real billable
// providers. Empty values also prevent dotenv from restoring credentials.
const providerEnvironment = {
  AI_API_KEY: "",
  OPENAI_API_KEY: "",
  AI_BASE_URL: "",
  AI_MODEL: "",
  AI_REPORT_MODEL: "",
  AI_CHAT_MODEL: "",
  AI_REPORT_MAX_OUTPUT_TOKENS: "",
  FIREBASE_PROJECT_ID: "",
  RESEND_API_KEY: "",
  EMAIL_FROM: "",
  SUPABASE_URL: "",
  SUPABASE_SECRET_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  SUPABASE_STORAGE_BUCKET: "",
  STORAGE_PROVIDER: "local",
  ENABLE_JOBS: "false",
};
function disableExternalProviders() {
  Object.assign(process.env, providerEnvironment);
}
module.exports = { providerEnvironment, disableExternalProviders };
