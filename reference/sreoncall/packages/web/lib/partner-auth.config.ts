import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import GithubProvider from 'next-auth/providers/github';
import type { NextAuthConfig } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    partnerToken?: string;
    partner: {
      partnerUserId: string;
      partnerId: string;
      email: string;
      name: string;
      company: string;
      partnerType: string;
      commissionRate: number;
    };
  }
  interface User {
    partnerId?: string;
    company?: string;
    partnerType?: string;
    commissionRate?: number;
    partnerToken?: string;
  }
  interface JWT {
    partnerId?: string;
    company?: string;
    partnerType?: string;
    commissionRate?: number;
    partnerToken?: string;
  }
}

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || 'http://127.0.0.1:8000';

async function fetchPartnerMe(token: string): Promise<{
  partnerUser: { _id: string; name: string; email: string };
  partner: { _id: string; company: string; partnerType: string; commissionRate: number };
} | null> {
  try {
    const meRes = await fetch(`${INTERNAL_API_URL}/api/v1/partner-auth/me`, {
      headers: { Cookie: `partner_token=${token}` },
    });
    if (!meRes.ok) return null;
    return await meRes.json();
  } catch {
    return null;
  }
}

function extractPartnerToken(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(/partner_token=([^;]+)/);
  return match ? match[1] : null;
}

const credentialsProvider = CredentialsProvider({
  name: 'credentials',
  credentials: {
    email: { label: 'Email', type: 'email' },
    password: { label: 'Password', type: 'password' },
  },
  async authorize(credentials) {
    if (!credentials?.email || !credentials?.password) return null;

    try {
      const res = await fetch(`${INTERNAL_API_URL}/api/v1/partner-auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: credentials.email,
          password: credentials.password,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail || 'Invalid email or password');
      }

      const partnerToken = extractPartnerToken(res.headers.get('set-cookie'));
      if (!partnerToken) return null;

      const meData = await fetchPartnerMe(partnerToken);
      if (!meData) return null;

      const { partnerUser, partner } = meData;

      return {
        id: partnerUser._id,
        email: String(credentials.email),
        name: partnerUser.name,
        partnerId: partner._id,
        company: partner.company,
        partnerType: partner.partnerType,
        commissionRate: partner.commissionRate,
        partnerToken,
      };
    } catch (error) {
      if (error instanceof Error) throw error;
      return null;
    }
  },
});

const oauthProviders = [];
if (process.env.PARTNER_GOOGLE_CLIENT_ID && process.env.PARTNER_GOOGLE_CLIENT_SECRET) {
  oauthProviders.push(GoogleProvider({
    clientId: process.env.PARTNER_GOOGLE_CLIENT_ID,
    clientSecret: process.env.PARTNER_GOOGLE_CLIENT_SECRET,
  }));
}
if (process.env.PARTNER_GITHUB_CLIENT_ID && process.env.PARTNER_GITHUB_CLIENT_SECRET) {
  oauthProviders.push(GithubProvider({
    clientId: process.env.PARTNER_GITHUB_CLIENT_ID,
    clientSecret: process.env.PARTNER_GITHUB_CLIENT_SECRET,
  }));
}

export const partnerAuthConfig: NextAuthConfig = {
  trustHost: true,
  providers: [credentialsProvider, ...oauthProviders],
  callbacks: {
    async jwt({ token, user, account }) {
      if (user && account?.provider !== 'credentials') {
        // OAuth flow
        try {
          const res = await fetch(`${INTERNAL_API_URL}/api/v1/partner-auth/oauth-exchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider: account?.provider,
              providerId: account?.providerAccountId,
              email: user.email,
              name: user.name,
            }),
          });

          if (res.ok) {
            const partnerToken = extractPartnerToken(res.headers.get('set-cookie'));
            if (partnerToken) {
              const meData = await fetchPartnerMe(partnerToken);
              if (meData) {
                const { partnerUser, partner } = meData;
                token.sub = partnerUser._id;
                token.partnerId = partner._id;
                token.company = partner.company;
                token.partnerType = partner.partnerType;
                token.commissionRate = partner.commissionRate;
                token.partnerToken = partnerToken;
                token.email = partnerUser.email;
                token.name = partnerUser.name;
              }
            }
          }
        } catch (error) {
          console.error('Partner OAuth exchange failed:', error);
        }
      } else if (user && account?.provider === 'credentials') {
        // Credentials flow — user object has all fields from authorize
        token.sub = user.id;
        token.partnerId = user.partnerId;
        token.company = user.company;
        token.partnerType = user.partnerType;
        token.commissionRate = user.commissionRate;
        token.partnerToken = user.partnerToken;
      }

      return token;
    },
    async session({ session, token }) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = token as any;
      session.partnerToken = t.partnerToken;
      session.partner = {
        partnerUserId: token.sub || '',
        partnerId: t.partnerId || '',
        email: t.email || session.user?.email || '',
        name: t.name || session.user?.name || '',
        company: t.company || '',
        partnerType: t.partnerType || '',
        commissionRate: t.commissionRate ?? 0,
      };
      return session;
    },
  },
  pages: {
    signIn: '/partner/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 hours
  },
};

export const {
  handlers: partnerHandlers,
  auth: partnerAuth,
  signIn: partnerSignIn,
  signOut: partnerSignOut,
} = NextAuth(partnerAuthConfig);
