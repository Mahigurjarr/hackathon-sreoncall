import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import type { NextAuthConfig } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    tenantSlug?: string;
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
      tenantId: string;
      tenantType?: string;
      image?: string | null;
    };
  }

  interface User {
    accessToken?: string;
    role?: string;
    tenantId?: string;
    tenantSlug?: string;
    tenantType?: string;
  }
}

const BASE_DOMAINS = ['dev-web.sreoncall.com', 'web.sreoncall.com', 'sreoncall.com', 'localhost'];

function extractTenantSlug(host: string): string {
  const h = host.toLowerCase().replace(/:\d+$/, '');
  if (BASE_DOMAINS.includes(h)) return 'platform';
  for (const base of BASE_DOMAINS) {
    if (h.endsWith('.' + base)) {
      return h.slice(0, -(base.length + 1)).split('.')[0] || 'platform';
    }
  }
  const parts = h.split('.');
  return parts.length >= 3 ? parts[0] : 'platform';
}

export const authConfig: NextAuthConfig = {
  trustHost: true,
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        org_slug: { label: 'Organization Slug', type: 'text' },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const forwardedHost =
          request?.headers?.get?.('x-forwarded-host') ||
          request?.headers?.get?.('host') ||
          '';

        // Prefer explicit org_slug from form over hostname extraction
        const tenantSlug =
          (credentials.org_slug as string)?.trim() ||
          (forwardedHost ? extractTenantSlug(forwardedHost) : 'platform');

        const password = credentials.password as string;

        // SSO/MFA token flow: password prefixed with __sso_token__:
        if (password.startsWith('__sso_token__:')) {
          const ssoToken = password.slice('__sso_token__:'.length);
          try {
            // Verify token by calling /auth/me
            const meRes = await fetch(
              `${process.env.INTERNAL_API_URL}/api/v1/auth/me`,
              {
                headers: {
                  Authorization: `Bearer ${ssoToken}`,
                  'X-Tenant-Slug': tenantSlug,
                  ...(forwardedHost ? { 'X-Forwarded-Host': forwardedHost } : {}),
                },
              },
            );

            if (!meRes.ok) throw new Error('Invalid SSO token');
            const me = await meRes.json();

            return {
              id: me.id,
              email: me.email,
              name: me.name || me.email,
              image: me.avatar_url || null,
              accessToken: ssoToken,
              role: me.roles?.[0] || 'agent',
              tenantId: me.tenant?.id || '',
              tenantSlug: me.tenant?.slug || tenantSlug,
              tenantType: me.tenant?.type || 'standalone',
            };
          } catch {
            throw new Error('SSO authentication failed');
          }
        }

        try {
          const res = await fetch(
            `${process.env.INTERNAL_API_URL}/api/v1/auth/login`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Tenant-Slug': tenantSlug,
                ...(forwardedHost ? { 'X-Forwarded-Host': forwardedHost } : {}),
              },
              body: JSON.stringify({
                email: credentials.email,
                password: credentials.password,
              }),
            },
          );

          if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            throw new Error(error.detail || 'Invalid credentials');
          }

          const data = await res.json();

          return {
            id: data.user.id,
            email: data.user.email,
            name: data.user.name || data.user.email,
            image: data.user.avatar_url || null,
            accessToken: data.access_token,
            role: data.user.role,
            tenantId: data.user.tenant_id,
            tenantSlug: tenantSlug,
            tenantType: data.user.tenant_type || 'standalone',
          };
        } catch (error) {
          if (error instanceof Error) {
            throw error;
          }
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async redirect({ url, baseUrl }) {
      // Protocol-relative ("//evil.com") and backslash ("/\evil.com") URLs
      // start with "/" but resolve to an external origin — they must NOT be
      // treated as safe relative paths (finding-004, pentest 2026-06-11).
      // Fall through to full origin validation below for those.
      if (/^\/[^/\\]/.test(url) || url === '/') return url;

      try {
        const target = new URL(url, baseUrl);

        // Block non-http(s) schemes outright (javascript:, data:, etc.)
        if (target.protocol !== 'http:' && target.protocol !== 'https:') {
          return baseUrl;
        }

        // Same origin as NEXTAUTH_URL / request host — always safe.
        if (target.origin === new URL(baseUrl).origin) return url;

        // Allow sreoncall.com and any *.sreoncall.com subdomain
        if (
          target.hostname === 'sreoncall.com' ||
          target.hostname.endsWith('.sreoncall.com')
        ) {
          return url;
        }

        // Localhost for dev only
        if (target.hostname === 'localhost' || target.hostname === '127.0.0.1') {
          return url;
        }

        // Any other external origin is an open-redirect attempt (F-10 in
        // security assessment 2026-04-17) — refuse and fall back to baseUrl.
      } catch {
        // invalid URL — fall through to default
      }
      return baseUrl;
    },
    async jwt({ token, user }) {
      if (user) {
        (token as any).accessToken = user.accessToken;
        (token as any).role = user.role;
        (token as any).tenantId = user.tenantId;
        (token as any).tenantSlug = user.tenantSlug;
        (token as any).tenantType = user.tenantType;
        token.sub = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      (session as any).accessToken = (token as any).accessToken;
      (session as any).tenantSlug = (token as any).tenantSlug || 'platform';
      session.user.id = token.sub || '';
      (session.user as any).role = (token as any).role || '';
      (session.user as any).tenantId = (token as any).tenantId || '';
      (session.user as any).tenantType = (token as any).tenantType || 'standalone';
      return session;
    },
  },
  pages: {
    signIn: '/signin',
  },
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 hours
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
