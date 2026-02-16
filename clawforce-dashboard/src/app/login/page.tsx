import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session) redirect("/");

  const params = await searchParams;
  const error = params.error;

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-gray-800 rounded-lg shadow-lg p-8">
        <h1 className="text-2xl font-bold text-white text-center mb-2">
          Clawforce Dashboard
        </h1>
        <p className="text-gray-400 text-center text-sm mb-6">
          Sign in to continue
        </p>

        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-300 text-sm rounded p-3 mb-4">
            Invalid credentials. Please try again.
          </div>
        )}

        <form
          action={async (formData: FormData) => {
            "use server";
            try {
              await signIn("credentials", {
                username: formData.get("username") as string,
                password: formData.get("password") as string,
                redirectTo: "/",
              });
            } catch (e) {
              // Auth.js throws a NEXT_REDIRECT on success, which is expected.
              // Re-throw redirects so Next.js handles them.
              if (
                e instanceof Error &&
                "digest" in e &&
                typeof (e as { digest?: string }).digest === "string" &&
                (e as { digest: string }).digest.startsWith("NEXT_REDIRECT")
              ) {
                throw e;
              }
              redirect("/login?error=credentials");
            }
          }}
        >
          <div className="mb-4">
            <label
              htmlFor="username"
              className="block text-sm font-medium text-gray-300 mb-1"
            >
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              required
              autoComplete="username"
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="Enter your username"
            />
          </div>

          <div className="mb-6">
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-300 mb-1"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="Enter your password"
            />
          </div>

          <button
            type="submit"
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
