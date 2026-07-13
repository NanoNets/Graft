/**
 * The benchmark corpus and task set. This file *is* the benchmark's validity:
 * every task must have a verifiable answer, and (for a fair cold-arm test)
 * require reading more than one file to answer confidently. Reference answers
 * here are grounded in the actual source (cited during authoring), not guessed.
 *
 * Corpora are real external repos expected as siblings of this one under the
 * same parent directory (override a path with BENCH_REPO_<ID_UPPER> if needed):
 *   - unified-accounts-login-server — the Nanonets unified auth service (Node/Express).
 *   - new-website — the Nanonets marketing site (Next.js App Router).
 * Plus the checked-in demo docs (northwind-docs) as a knowledge-folder data point.
 *
 * Note on fairness: ingestRepo summarizes only CODE files (CODE_EXTENSIONS), so
 * README/markdown/package.json/CSS do NOT enter the graph — while the cold agent
 * can read them. Questions therefore target multi-file *code* understanding,
 * where the graph bundle should actually help, not README/config lookups.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const parent = resolve(repoRoot, "..");

/** Sibling repo path by default; overridable via BENCH_REPO_<ID_UPPER> (dashes → underscores). */
function repoPath(id: string): string {
  const envKey = "BENCH_REPO_" + id.toUpperCase().replace(/-/g, "_");
  return process.env[envKey] ?? resolve(parent, id);
}

export interface Task {
  id: string;
  question: string;
  referenceAnswer: string;
  /** Case-insensitive substrings the answer must contain (deterministic floor). */
  requiredKeywords: string[];
}

export interface Corpus {
  id: string;
  /** "repo" → ingestRepo + agent reads source directly. "docs" → ingestDir + agent reads extracted text. */
  kind: "repo" | "docs";
  path: string;
  tasks: Task[];
}

const UNIFIED: Corpus = {
  id: "unified-accounts-login-server",
  kind: "repo",
  path: repoPath("unified-accounts-login-server"),
  tasks: [
    {
      id: "auth-provider-flows",
      question: "What authentication provider does this service use, and what login flows does it support?",
      referenceAnswer:
        "Auth0. Two flows: an Authorization Code flow for Google social login (connection google-oauth2), and a Resource Owner Password Grant (password-realm, realm Username-Password-Authentication) for on-page email/password login.",
      requiredKeywords: ["auth0"],
    },
    {
      id: "redirect-precedence",
      question: "After a successful login, how does the service decide which app to redirect the user to?",
      referenceAnswer:
        "splitService.getRedirectDestination resolves in order: a valid return_url first, then redirect_to (agents→AGENTS_URL, context→CONTEXT_URL/atlas.nanonets.ai, app→APP_NANONETS_URL), defaulting to APP_NANONETS_URL. return_url is validated to a hostname ending in nanonets.com, nanonets.ai, or exactly localhost.",
      requiredKeywords: ["return_url"],
    },
    {
      id: "session-cookie",
      question: "What is the session cookie called and what are its flags?",
      referenceAnswer:
        "The cookie is session_token: httpOnly false (frontends read it in JS), secure only in production, sameSite lax in dev / none in prod, domain unset in dev / .nanonets.com in prod, path '/'.",
      requiredKeywords: ["session_token"],
    },
    {
      id: "session-jwt",
      question: "How is the session token created and validated?",
      referenceAnswer:
        "sessionService mints a JWT signed with HS256 using SESSION_SECRET_KEY, with claims including session_id, email, user_id, auth_type 'auth0', redirect_app, and type:'session'; default expiry 24h applied to both the JWT exp and the cookie maxAge. Validation rejects any token whose type is not 'session'.",
      requiredKeywords: ["session"],
    },
    {
      id: "callback-csrf",
      question: "How does the /callback route protect against CSRF before exchanging the Auth0 code?",
      referenceAnswer:
        "It verifies the Auth0 `state` returned in the query against the value stored in the `auth_state` cookie, and only exchanges the code for tokens if they match.",
      requiredKeywords: ["auth_state"],
    },
    {
      id: "app-handoff",
      question: "When app-handoff is enabled, how does the server decide whether to send a user to the app or to agents?",
      referenceAnswer:
        "When appHandoff is enabled and there is no explicit return_url and redirect_to is empty or 'agents', it makes an HMAC-signed server-to-server call to app's user-exists endpoint; existing app users are 302'd to app via a one-time app_handoff code, while unknown/new users go to AGENTS_URL. On any error/timeout it defaults to agents. The logic exists twice (in /callback and in finalizeAuthSession for the password path).",
      requiredKeywords: ["handoff"],
    },
    {
      id: "required-config",
      question: "Which configuration values are required for the server to boot, and what happens if they are missing?",
      referenceAnswer:
        "validateConfig() runs at startup and process.exit(1)s if AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, or SESSION_SECRET_KEY are missing (plus the app-handoff secrets when handoff is enabled).",
      requiredKeywords: ["auth0_client_id", "session_secret_key"],
    },
    {
      id: "product-preference",
      question: "How is a user's product preference stored and where is it set?",
      referenceAnswer:
        "It is stored in a SQLite table user_preferences (email primary key, preferred_app). The POST /choose-product route writes it via userService.setUserPreference and only accepts product in {app, agents}.",
      requiredKeywords: ["preference"],
    },
    {
      id: "signup-password-stash",
      question: "During signup with email verification, how are the user's credentials handled while waiting for verification?",
      referenceAnswer:
        "signupIntentService stores the signup password AES-256-GCM-encrypted with an HKDF-derived key from SESSION_SECRET_KEY, with a 30-minute TTL; consumption is single-use and uses crypto.timingSafeEqual.",
      requiredKeywords: ["encrypt"],
    },
    {
      id: "entry-and-port",
      question: "What is the server's entry point and what port does it listen on by default?",
      referenceAnswer:
        "The entry point is src/app.js (an Express app); the default port is 5001 (env PORT). Note the README/.env.example mention 3000, but the code default is 5001.",
      requiredKeywords: ["5001"],
    },
  ],
};

const NEW_WEBSITE: Corpus = {
  id: "new-website",
  kind: "repo",
  path: repoPath("new-website"),
  tasks: [
    {
      id: "framework",
      question: "What framework and routing approach does this site use?",
      referenceAnswer:
        "Next.js (v16) with the App Router (file-based routing under src/app), React 19, and TypeScript.",
      requiredKeywords: ["next.js"],
    },
    {
      id: "dynamic-route",
      question: "Is there any dynamic route, and what does it do?",
      referenceAnswer:
        "Yes — /customers/unlock/[slug], a password-gated case-study route. It calls notFound() unless the slug is in PROTECTED_SLUGS, and marks itself robots noindex.",
      requiredKeywords: ["unlock"],
    },
    {
      id: "case-study-auth",
      question: "How does the case-study password gate actually work, and is it secure?",
      referenceAnswer:
        "It is client-side only: passwords are a hardcoded slug→password map in src/lib/case-study-passwords.ts, and UnlockForm compares the typed password in the browser. The passwords are shipped to the client, so it is not real security.",
      requiredKeywords: ["client"],
    },
    {
      id: "redirects",
      question: "Where are URL redirects configured and give an example.",
      referenceAnswer:
        "In next.config.ts, which defines several permanent redirects (e.g. /agent → /agents, /products/nano → /agent/nano, /case-studies/roche → /customers/roche). middleware.ts is a no-op.",
      requiredKeywords: ["redirect"],
    },
    {
      id: "analytics-stack",
      question: "What analytics and tracking tools are wired into the site?",
      referenceAnswer:
        "PostHog plus Google Tag Manager, Google Analytics (gtag), LinkedIn Insight, Intercom, and Termly consent — mostly gated on production. PostHog is set up in src/components/analytics.tsx.",
      requiredKeywords: ["posthog"],
    },
    {
      id: "posthog-proxy",
      question: "How are PostHog analytics requests routed?",
      referenceAnswer:
        "next.config.ts rewrites /ingest/* to https://events.nanonets.com (a self-hosted PostHog proxy); the PostHog host defaults to events.nanonets.com.",
      requiredKeywords: ["ingest"],
    },
    {
      id: "primary-cta",
      question: "What is the site's primary call-to-action and how is it implemented?",
      referenceAnswer:
        "A 'Book a demo' button (BookDemoButton) that opens a Calendly scheduling URL and fires a LinkedIn conversion on calendly.event_scheduled; it is used across most pages.",
      requiredKeywords: ["calendly"],
    },
    {
      id: "forms",
      question: "How are lead-capture forms (e.g. the AP cost calculator) served?",
      referenceAnswer:
        "As static HTML files under public/forms/, wired via next.config.ts rewrites (/forms/<name> → /forms/<name>.html). There are no Next API routes.",
      requiredKeywords: ["forms"],
    },
    {
      id: "styling",
      question: "What styling system does the site use?",
      referenceAnswer:
        "Tailwind CSS v4 via @tailwindcss/postcss, with no tailwind.config file — theme tokens are defined in CSS (@theme) in globals.css. Font is DM Sans via next/font.",
      requiredKeywords: ["tailwind"],
    },
    {
      id: "content-source",
      question: "Where does the page content come from — a CMS, markdown, or code?",
      referenceAnswer:
        "Content is hardcoded in TSX components/pages; there is no CMS and no MDX/markdown content source, and no data-fetching calls.",
      requiredKeywords: [],
    },
  ],
};

const NORTHWIND_DOCS: Corpus = {
  id: "northwind-docs",
  kind: "docs",
  path: resolve(repoRoot, "examples", "demo-docs"),
  tasks: [
    {
      id: "failed-charge-flow",
      question: "What happens when a customer charge fails in the Northwind billing system?",
      referenceAnswer:
        "The Payments Service emits payment_failed; the Dunning Worker retries up to 3 times with exponential backoff (1h, 6h, 24h). After the third failed retry the subscription is marked past_due, and after 7 days past_due it is automatically suspended.",
      requiredKeywords: ["past_due"],
    },
    {
      id: "token-expiry",
      question: "How long do Northwind access tokens last, and what backs the Auth Service?",
      referenceAnswer:
        "Access tokens expire after 15 minutes and refresh tokens after 30 days; the Auth Service is backed by Redis for token revocation lists.",
      requiredKeywords: ["redis"],
    },
    {
      id: "databases",
      question: "Which databases do the Orders and Inventory services use?",
      referenceAnswer:
        "The Orders Service uses a PostgreSQL database named orders_db and the Inventory Service uses a separate PostgreSQL database named inventory_db.",
      requiredKeywords: ["orders_db", "inventory_db"],
    },
    {
      id: "billing-escalation",
      question: "Who do you escalate a Stripe outage to in billing, and where do you post updates?",
      referenceAnswer:
        "Escalate to the Payments team lead, Dana Whitfield, and post an update in the #billing-incidents Slack channel; page on-call via PagerDuty service 'northwind-billing'.",
      requiredKeywords: ["dana"],
    },
    {
      id: "charge-success-alert",
      question: "What is the target charge success rate, and when does an alert fire?",
      referenceAnswer:
        "Target charge success rate is above 97%; an alert fires if it drops below 95% over any 30-minute window.",
      requiredKeywords: ["97"],
    },
    {
      id: "notifications-providers",
      question: "How does Northwind send transactional email and SMS?",
      referenceAnswer: "The Notifications Service sends transactional email through SendGrid and SMS through Twilio.",
      requiredKeywords: ["sendgrid", "twilio"],
    },
    {
      id: "deployment",
      question: "Where and how is Northwind deployed?",
      referenceAnswer:
        "On Kubernetes in AWS us-east-1; each service is a separate Deployment with a minimum of 3 replicas; images are built by GitHub Actions and pushed to Amazon ECR; production deploys require Platform-team approval.",
      requiredKeywords: ["us-east-1"],
    },
    {
      id: "refund-approval",
      question: "What approval is needed to issue a large refund?",
      referenceAnswer:
        "Refunds above $500 require approval from a Finance team lead; all refunds are logged to the audit_log table in payments_db and reflected in Stripe within 24 hours.",
      requiredKeywords: ["500"],
    },
    {
      id: "org-structure",
      question: "How is Northwind engineering organized and who is the VP of Engineering?",
      referenceAnswer:
        "Four teams — Platform (infra/CI-CD), Payments (Payments Service and billing), Orders (Orders and Inventory), and Growth (Notifications and customer-facing). The VP of Engineering is Priya Nair.",
      requiredKeywords: ["priya"],
    },
    {
      id: "local-setup",
      question: "What are the steps to set up the Northwind platform locally?",
      referenceAnswer:
        "Clone the northwind-inc/platform monorepo, install Node.js 20 and Docker, run 'make bootstrap' to start local Postgres/Redis/Kafka via docker-compose, copy .env.sample to .env with your API keys, and run 'make test'.",
      requiredKeywords: ["bootstrap"],
    },
  ],
};

export const CORPORA: Corpus[] = [UNIFIED, NEW_WEBSITE, NORTHWIND_DOCS];
