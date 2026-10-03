# Local workspace and Manim Cloud

Install Manimate once:

```sh
curl -fsSL https://manimate.ai/install.sh | bash
```

The setup installs the selected rendering dependencies and a bundled Manim Cloud CLI. Choose Local for Manim on your machine or Cloud for Google sign-in and remote rendering. Run `manimate --setup` to change the choice later. Cloud is free during the public beta and subject to shared usage limits.

The Chrome extension discovers a running local workspace. **Start Manimate** launches an installed app through the native messaging host, waits for readiness, and opens it. The initial terminal setup also registers that helper on macOS and Linux. The unpacked extension uses its stable manifest key; a store release must register the assigned store extension ID.

The local sidebar's **Cloud videos** opens your saved library. **Edit in Manimate** restores an authenticated project backup if it is not already on the current machine. Each completed cloud render and changed final video is retained as a version. **Share** uploads the final video and returns a public watch link. Local-only projects stay local.

The website is a separate Cloudflare Worker in `manimate-site`. The cloud renderer, Google accounts, project metadata and library live in `manim-cloud`: Workers, Durable Objects, D1, KV and R2. The new system does not use Supabase, Vercel, E2B, Portkey, Stripe, Sentry or Resend. `Manimate-Infra` remains the archived hosted-chat implementation.
