export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-black text-white">
      <main className="flex flex-col items-center gap-4 px-6 text-center">
        <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">
          Vice <span className="text-zinc-500">and</span> Virtue
        </h1>
        <p className="max-w-md text-lg text-zinc-400">
          Deceive. Persuade. Survive. The winner will shape the new world.
          <br />
          <span className="text-zinc-600">(if you see this line, hot reload works)</span>
        </p>
        <p className="mt-8 text-sm text-zinc-600">
          Edit <code className="rounded bg-zinc-800 px-2 py-1">src/app/page.tsx</code> to change this screen.
        </p>
      </main>
    </div>
  );
}
