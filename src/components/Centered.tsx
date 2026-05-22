// Full-screen centered layout, used for loading / error / waiting states.
export function Centered({
  children,
  className = "bg-home-bg text-cream",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main
      className={
        "flex min-h-screen flex-col items-center justify-center px-6 text-center " +
        className
      }
    >
      {children}
    </main>
  );
}
