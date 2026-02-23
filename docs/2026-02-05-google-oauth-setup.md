# Google OAuth Setup for Supabase

This guide walks through configuring Google OAuth for the Manim SaaS application.

## Prerequisites

- A Google Cloud Console account
- A Supabase project (already configured in `.env`)

## Step 1: Google Cloud Console - OAuth Consent Screen

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Navigate to **APIs & Services** > **OAuth consent screen**
4. Choose **External** user type (unless you have Google Workspace)
5. Fill in the required fields:
   - **App name**: Manim SaaS (or your preferred name)
   - **User support email**: Your email
   - **Developer contact email**: Your email
6. Click **Save and Continue**
7. On the **Scopes** page, click **Add or Remove Scopes**:
   - Select `.../auth/userinfo.email`
   - Select `.../auth/userinfo.profile`
   - Select `openid`
8. Click **Save and Continue**
9. On the **Test users** page, add your email for testing (only needed while in testing mode)
10. Click **Save and Continue** and then **Back to Dashboard**

## Step 2: Google Cloud Console - Create OAuth Credentials

1. Navigate to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. Select **Web application** as the application type
4. Set the name (e.g., "Manim SaaS Web Client")
5. Add **Authorized JavaScript origins**:
   - `http://localhost:3000` (local development)
   - `https://your-production-domain.com` (production)
6. Add **Authorized redirect URIs**:
   - `https://jaoqomfyukstdaoxuspz.supabase.co/auth/v1/callback` (Supabase callback)
7. Click **Create**
8. Copy the **Client ID** and **Client Secret** - you'll need these for Supabase

## Step 3: Supabase Dashboard - Enable Google Provider

1. Go to [Supabase Dashboard](https://supabase.com/dashboard/project/jaoqomfyukstdaoxuspz)
2. Navigate to **Authentication** > **Providers**
3. Find **Google** in the list and click to expand
4. Toggle **Enable Sign in with Google** to ON
5. Enter the **Client ID** from Step 2
6. Enter the **Client Secret** from Step 2
7. Click **Save**

## Step 4: Configure Redirect URLs

Supabase needs to know where to redirect after authentication:

1. In Supabase Dashboard, go to **Authentication** > **URL Configuration**
2. Set **Site URL** to:
   - Local: `http://localhost:3000`
   - Production: `https://your-production-domain.com`
3. Add to **Redirect URLs**:
   - `http://localhost:3000/auth/callback` (local)
   - `https://your-production-domain.com/auth/callback` (production)

## Verification

After completing the setup:

1. Start the development server: `npm run dev`
2. Navigate to `http://localhost:3000/login`
3. Click "Sign in with Google"
4. Complete the Google OAuth flow
5. You should be redirected back to the app and signed in

## Troubleshooting

### "redirect_uri_mismatch" Error

This means the redirect URI in your Google Cloud Console doesn't match what Supabase is sending. Ensure you have the exact Supabase callback URL:
```
https://jaoqomfyukstdaoxuspz.supabase.co/auth/v1/callback
```

### "Access blocked: This app's request is invalid"

This usually means:
- The OAuth consent screen is not properly configured
- You're not listed as a test user (while app is in testing mode)
- The scopes are not properly set

### User Not Created in Database

If the user signs in but no row appears in the `users` table:
- Verify the `handle_new_user` trigger is properly installed
- Check the Supabase logs for any trigger errors

## Production Deployment

Before going live:

1. In Google Cloud Console, go to **OAuth consent screen**
2. Click **Publish App** to move out of testing mode
3. Update all URLs from localhost to your production domain
4. Ensure your production domain is in the authorized origins/redirects
