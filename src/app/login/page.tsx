import { signIn } from "./actions";

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-6xl justify-center px-5 py-12 sm:px-8 sm:py-20">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Sign in</h1>
        <p className="mt-2 text-sm text-slate-600">Enter your Hebacademy account details.</p>

        <form action={signIn} className="mt-8 space-y-5">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20" />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20" />
          </div>
          {error === "invalid" && (
            <p role="alert" className="text-sm text-red-700">Unable to sign in. Check your email and password.</p>
          )}
          <button type="submit" className="inline-flex w-full items-center justify-center rounded-lg bg-teal-700 px-5 py-2.5 font-medium text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">Sign in</button>
        </form>
      </div>
    </main>
  );
}
