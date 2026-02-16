import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { getReadDb } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;

        const db = getReadDb();
        if (!db) return null;

        const user = db
          .prepare(
            "SELECT id, username, password_hash, role FROM dashboard_users WHERE username = ?",
          )
          .get(String(credentials.username)) as
          | {
              id: string;
              username: string;
              password_hash: string;
              role: string;
            }
          | undefined;

        if (!user) return null;
        const valid = await compare(
          String(credentials.password),
          user.password_hash,
        );
        if (!valid) return null;

        return { id: user.id, name: user.username, role: user.role };
      },
    }),
  ],
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 24 * 60 * 60 },
  callbacks: {
    jwt({ token, user }) {
      if (user) token.role = (user as { role?: string }).role;
      return token;
    },
    session({ session, token }) {
      if (token.role)
        (session.user as { role?: string }).role = token.role as string;
      return session;
    },
  },
});
