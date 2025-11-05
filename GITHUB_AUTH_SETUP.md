# GitHub OAuth Setup Guide

This guide will help you set up GitHub authentication for your LiveCaptions application.

## Step 1: Create a GitHub OAuth App

1. Go to [GitHub Settings → Developer settings → OAuth Apps](https://github.com/settings/developers)
2. Click "New OAuth App"
3. Fill in the application details:
   - **Application name**: LiveCaptions (or your preferred name)
   - **Homepage URL**: `http://localhost:3000` (for development)
   - **Authorization callback URL**: `http://localhost:3000/auth/callback`
4. Click "Register application"
5. After creation, you'll see your **Client ID**
6. Click "Generate a new client secret" to get your **Client Secret**
7. **Important**: Copy both the Client ID and Client Secret - you'll need them in the next step

## Step 2: Configure Supabase

### Option A: Using Supabase Dashboard (Recommended)

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Navigate to **Authentication → Providers**
4. Find **GitHub** in the list of providers
5. Enable the GitHub provider
6. Enter your GitHub OAuth credentials:
   - **Client ID**: Paste the Client ID from Step 1
   - **Client Secret**: Paste the Client Secret from Step 1
7. Click "Save"

### Option B: Using Supabase CLI

If you're using local development with Supabase CLI:

1. Update your `supabase/config.toml` file:

```toml
[auth.external.github]
enabled = true
client_id = "your_github_client_id"
secret = "your_github_client_secret"
redirect_uri = "http://localhost:54321/auth/v1/callback"
```

2. Restart your Supabase local instance:

```bash
supabase stop
supabase start
```

## Step 3: Update Environment Variables (if needed)

If you're using custom redirect URLs, you can set them in your `.env.local`:

```env
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

## Step 4: Production Setup

When deploying to production:

1. Create a **new** GitHub OAuth App for production (or update your existing one)
2. Update the URLs:
   - **Homepage URL**: `https://yourdomain.com`
   - **Authorization callback URL**: `https://yourdomain.com/auth/callback`
3. Update the credentials in your Supabase production project
4. Ensure your production environment variables are set correctly

## Step 5: Test the Integration

1. Start your development server:

```bash
npm run dev
# or
pnpm dev
```

2. Navigate to `http://localhost:3000/auth/signin`
3. Click "Continue with GitHub"
4. You should be redirected to GitHub for authorization
5. After authorization, you'll be redirected back to your dashboard

## Troubleshooting

### "Authorization callback URL mismatch" error

- Make sure the callback URL in your GitHub OAuth App matches exactly: `http://localhost:3000/auth/callback`
- For production, use: `https://yourdomain.com/auth/callback`

### "Invalid client credentials" error

- Double-check that you copied the correct Client ID and Client Secret
- Make sure there are no extra spaces when pasting the credentials

### Redirect loop or "auth_failed" error

- Check your Supabase configuration is correct
- Verify that the callback route exists at `/app/auth/callback/route.ts`
- Check browser console and Network tab for detailed error messages

### Users not being created

- Ensure email confirmations are configured correctly in Supabase
- Check Authentication → Settings → Email templates in your Supabase dashboard

## Additional Configuration

### Requesting Additional Scopes

By default, GitHub OAuth requests basic profile information. If you need additional scopes (e.g., to access user's repositories), update the auth code:

```typescript
await supabase.auth.signInWithOAuth({
  provider: "github",
  options: {
    redirectTo: `${window.location.origin}/auth/callback`,
    scopes: "read:user user:email", // Add additional scopes here
  },
});
```

### Customizing the Redirect

You can customize where users are redirected after authentication by modifying the callback route at `/app/auth/callback/route.ts`.

## Security Notes

1. **Never commit** your GitHub Client Secret to version control
2. Use different OAuth Apps for development and production
3. Regularly rotate your Client Secret
4. Monitor your OAuth App usage in GitHub Settings

## Resources

- [Supabase Auth Documentation](https://supabase.com/docs/guides/auth)
- [GitHub OAuth Documentation](https://docs.github.com/en/developers/apps/building-oauth-apps/authorizing-oauth-apps)
- [Supabase Auth with GitHub](https://supabase.com/docs/guides/auth/social-login/auth-github)
