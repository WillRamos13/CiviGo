// Integration fixtures exercise local HTTP/database flows, never real billable
// providers. Empty values also prevent dotenv from restoring credentials.
const providerEnvironment = {
  AI_API_KEY: "",
  OPENAI_API_KEY: "",
  AI_BASE_URL: "",
  AI_MODEL: "",
  TWILIO_ACCOUNT_SID: "",
  TWILIO_AUTH_TOKEN: "",
  TWILIO_VERIFY_SERVICE_SID: "",
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
