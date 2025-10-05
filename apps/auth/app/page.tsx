import { auth } from "../lib/db/auth";
import { prisma } from "../lib/db/prisma";
import { signIn, signOut } from "../lib/db/auth";

const Page = async () => {
  const session = await auth();

  const user = session?.user?.id
    ? await prisma.user.findUnique({
        where: {
          id: session.user.id,
        },
      })
    : null;

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="bg-neutral-800 rounded-lg p-6 max-w-xl w-full">
        {!session ? (
          <div className="text-center">
            <button
              onClick={async () => {
                "use server";
                await signIn("github");
              }}
              className="bg-neutral-700 text-white p-2 rounded-md cursor-pointer"
            >
              Sign In with GitHub
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-center">
              <p className="text-gray-300">Signed in as:</p>
              <p className="text-white">{session.user?.email}</p>
            </div>

            <div className="text-center">
              <p className="text-gray-300">Data fetched from DB with Prisma:</p>
            </div>

            <div className="bg-neutral-900 rounded p-3">
              <pre className="text-xs text-gray-300">{JSON.stringify(user, null, 2)}</pre>
            </div>

            <div className="text-center">
              <button
                onClick={async () => {
                  "use server";
                  await signOut();
                }}
                className="bg-neutral-700 text-white p-2 rounded-md cursor-alias"
              >
                Sign Out
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Page;
