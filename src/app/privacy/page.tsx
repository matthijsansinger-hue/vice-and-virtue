/* eslint-disable react/no-unescaped-entities */
// Privacy notice. Static content page at /privacy. Written to be fully
// transparent about exactly what data Vice and Virtue stores (Supabase +
// PostHog) and why. The operator's details, providers and retention are filled
// in from the current implementation. It is still strongly recommended to have
// the whole notice reviewed by a qualified lawyer before public launch — this
// is written by the developer, not legal advice.

import Link from "next/link";

export const metadata = {
  title: "Privacy Notice — Vice and Virtue",
  description:
    "Exactly what personal data Vice and Virtue collects and stores, why, where, for how long, and your rights.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-home-bg px-5 py-12 text-cream">
      <article className="mx-auto w-full max-w-3xl leading-relaxed">
        <Link href="/" className="text-sm text-gold underline">
          ← Back to the game
        </Link>

        <h1 className="mt-6 text-3xl font-semibold text-gold">Privacy Notice</h1>
        <p className="mt-2 text-sm text-cream/70">Last updated: 6 July 2026</p>

        <p className="mt-6">
          This notice explains, plainly and in full, what personal data Vice and
          Virtue ("we", "us", the game at viceandvirtue.io) collects, why, where
          it is stored, how long we keep it, and the rights you have over it. We
          have tried to be completely transparent. If anything is unclear,
          contact us using the details at the end.
        </p>

        <p className="mt-4 rounded-lg border border-gold/40 bg-cream/5 p-3 text-sm text-cream/80">
          <strong>Who is responsible (data controller):</strong>{" "}
          M.M. Ansinger (Nowmat Studios), the Netherlands — contact:{" "}
          <a href="mailto:Nowmatstudios@gmail.com" className="text-gold underline">
            Nowmatstudios@gmail.com
          </a>
          .
        </p>

        <Section title="1. The short version">
          <ul className="ml-5 list-disc space-y-1">
            <li>
              You can play as a <strong>guest</strong> without an account.
              Creating a room and saving your stats requires an{" "}
              <strong>account</strong> (email + password).
            </li>
            <li>
              We store your account details, your in-game activity, your{" "}
              <strong>chat messages</strong>, your avatar, and gameplay
              statistics.
            </li>
            <li>
              We use a privacy-focused analytics tool (PostHog, hosted in the
              EU). No advertising, no session recording, no third-party tracking
              cookies.
            </li>
            <li>
              Game rooms and all in-game chat are{" "}
              <strong>automatically deleted about 24 hours</strong> after the
              room is created.
            </li>
            <li>
              Our database, login, file storage and analytics run on{" "}
              <strong>Supabase</strong>, <strong>Vercel</strong> and{" "}
              <strong>PostHog</strong>.
            </li>
          </ul>
        </Section>

        <Section title="2. Exactly what we collect, and when">
          <h3 className="mt-4 font-semibold text-cream">
            a) The moment you open the site — even before you sign in
          </h3>
          <ul className="ml-5 mt-1 list-disc space-y-1">
            <li>
              Our analytics (PostHog) records a <strong>page view</strong> and a{" "}
              <strong>randomly-generated device identifier</strong>, stored in
              your browser's local storage (not a cookie). It lets us count
              returning visitors without identifying you by name.
            </li>
            <li>
              Your <strong>browser type and operating system</strong> are
              recorded by analytics.
            </li>
            <li>
              We do <strong>not</strong> store your IP address in our analytics
              (PostHog&rsquo;s &ldquo;Discard client IP data&rdquo; setting is
              enabled).
            </li>
            <li>
              If you are already signed in, your session is restored and your
              analytics activity is linked to your account's{" "}
              <strong>internal id only — a random UUID, never your email or
              username</strong>.
            </li>
          </ul>

          <h3 className="mt-4 font-semibold text-cream">
            b) If you play as a guest (no account)
          </h3>
          <ul className="ml-5 mt-1 list-disc space-y-1">
            <li>
              The <strong>display name you choose</strong> (shown to the other
              players in your game).
            </li>
            <li>
              A <strong>random player id</strong> kept in your browser so you
              keep your seat if you refresh or reconnect.
            </li>
            <li>
              Your in-game activity for that game: the room you join, your
              secret role, your actions, votes, minigame score, and any{" "}
              <strong>chat messages</strong> you send (see (d)).
            </li>
          </ul>

          <h3 className="mt-4 font-semibold text-cream">
            c) If you create an account
          </h3>
          <p className="mt-1">Handled by Supabase Authentication:</p>
          <ul className="ml-5 mt-1 list-disc space-y-1">
            <li>
              Your <strong>email address</strong> and a{" "}
              <strong>password</strong>. The password is stored only as a secure
              hash — we never see or keep it in plain text.
            </li>
            <li>
              Email is used to confirm your account and to reset your password.
              You log in with your email.
            </li>
            <li>
              A <strong>username</strong> (shown publicly to other players).
            </li>
            <li>
              A <strong>character avatar</strong> you design (a set of style
              choices such as build, hair and colours — not an uploaded photo),
              stored with your profile and shown publicly.
            </li>
            <li>
              Any <strong>featured badges</strong> you choose to display, and
              the date your account was created.
            </li>
          </ul>

          <h3 className="mt-4 font-semibold text-cream">
            d) In-game data and chat
          </h3>
          <ul className="ml-5 mt-1 list-disc space-y-1">
            <li>
              Your assigned <strong>secret role</strong>, votes, minigame
              answers and score, in-match energy, and player state (active /
              imprisoned / hospitalised / out).
            </li>
            <li>
              The <strong>chat messages</strong> you send: one-to-one "outreach"
              messages, group consultation chat, team (camp) chat, and
              dead-player chat. They are visible to other players according to
              the game's rules and are stored until the room is deleted.
            </li>
            <li>Whether you have been muted, and your connection state.</li>
          </ul>

          <h3 className="mt-4 font-semibold text-cream">
            e) Friends, statistics and progression (accounts only)
          </h3>
          <ul className="ml-5 mt-1 list-disc space-y-1">
            <li>Your friendships (who you have added, and who added you).</li>
            <li>
              Your <strong>game results</strong> — which finished games you
              played, your role and team, and whether your side won — used for
              your profile statistics and the worldwide leaderboard.
            </li>
            <li>
              Your achievements/badges, in-game currencies (Life Proficiency,
              Mano, Soul Fragments, XP and level) and ranked standing.
            </li>
          </ul>

          <h3 className="mt-4 font-semibold text-cream">
            f) Safety and moderation
          </h3>
          <p className="mt-1">
            If you <strong>report</strong> another player, or are reported, we
            log the report: who reported whom, an optional reason, and the game
            it happened in. We use this to detect and act on abuse; after enough
            separate reports in one game, a player is automatically muted for
            that game. We also filter messages for slurs and profanity.
          </p>

          <h3 className="mt-4 font-semibold text-cream">
            g) Stored on your own device (local storage, not cookies)
          </h3>
          <p className="mt-1">
            For the app to work, small items are kept in your browser's local
            storage: your guest/player id and name, your analytics device id,
            which first-time tips you have dismissed, your daily-reward claim
            date, and your per-game block/report choices. These stay on your
            device.
          </p>
        </Section>

        <Section title="3. Where your data is stored, and who processes it">
          <p>
            We rely on the following service providers ("processors"), who store
            and process data on our behalf:
          </p>
          <ul className="ml-5 mt-2 list-disc space-y-1">
            <li>
              <strong>Supabase</strong> — database, authentication and realtime.
              Holds everything in sections 2(b)–2(f). Region:{" "}
              <strong>EU (West)</strong>.
            </li>
            <li>
              <strong>Vercel</strong> — hosts and serves the website; may process
              technical request logs. Served from Vercel&rsquo;s{" "}
              <strong>global edge network</strong>; your personal data is stored
              in the EU (see Supabase above).
            </li>
            <li>
              <strong>PostHog (EU Cloud)</strong> — product analytics (section
              2a). Hosted in the European Union.
            </li>
            <li>
              <strong>Resend</strong> — sends your account-confirmation and
              password-reset emails (processes your email address).
            </li>
            <li>
              <strong>Discord</strong> — if you click our Discord link you leave
              our site and Discord's own privacy policy applies.
            </li>
          </ul>
          <p className="mt-3 text-sm text-cream/70">
            Your personal data is stored within the <strong>EU/EEA</strong>.
            Some providers operate global infrastructure for content delivery
            and email routing; where any processing occurs outside the EU/EEA it
            is covered by that provider&rsquo;s standard data-protection
            safeguards (such as Standard Contractual Clauses).
          </p>
        </Section>

        <Section title="4. Why we use your data, and the legal basis">
          <ul className="ml-5 list-disc space-y-1">
            <li>
              <strong>To provide the game</strong> (accounts, matchmaking,
              gameplay, chat, friends, statistics): necessary to perform the
              service you ask for (contract).
            </li>
            <li>
              <strong>Account security and email</strong> (confirmation,
              password reset): contract and our legitimate interest in keeping
              accounts secure.
            </li>
            <li>
              <strong>Safety and moderation</strong> (reports, muting, message
              filtering): our and other players' legitimate interest in a safe
              service.
            </li>
            <li>
              <strong>Analytics</strong> (improving the game, understanding
              retention): your <strong>consent</strong>, which account holders
              give when creating an account (see below), and our legitimate
              interest in a privacy-preserving form for guest play (no ads, no
              cross-site tracking, no IP stored).
            </li>
          </ul>
          <p className="mt-3">
            <strong>How we obtain consent:</strong> when you create an account
            you confirm you have read and agree to this notice. There is no
            separate cookie or consent pop-up when you open the site. You can
            withdraw your consent at any time by contacting us (section 6); this
            does not affect processing that is necessary to run the game.
          </p>
        </Section>

        <Section title="5. How long we keep it">
          <ul className="ml-5 list-disc space-y-1">
            <li>
              <strong>Game rooms, players and all in-game chat:</strong>{" "}
              automatically deleted about <strong>24 hours</strong> after a room
              is created. Un-started lobbies are deleted after{" "}
              <strong>10 minutes</strong>.
            </li>
            <li>
              <strong>Account data</strong> (profile, username, avatar, email,
              friends, badges, currencies, ranked) and{" "}
              <strong>game results:</strong> kept while your account exists. Game
              results are retained for your statistics even after the room
              itself is deleted.
            </li>
            <li>
              <strong>Moderation reports:</strong> kept only as long as
              necessary to keep the game safe (to detect repeat abuse and act on
              it), and deleted when no longer needed for that purpose.
            </li>
            <li>
              <strong>Analytics:</strong> retained by PostHog for up to{" "}
              <strong>12 months</strong>, then deleted or aggregated.
            </li>
          </ul>
          <p className="mt-2">
            If you delete your account or ask us to erase your data, we remove
            your account data (see section 6).
          </p>
        </Section>

        <Section title="6. Your rights">
          <p>
            Under the GDPR (and comparable laws) you can ask us to:{" "}
            <strong>access</strong> the data we hold about you;{" "}
            <strong>correct</strong> inaccurate data; <strong>delete</strong>{" "}
            your data ("right to be forgotten"); <strong>restrict</strong> or{" "}
            <strong>object to</strong> certain processing; receive your data in a{" "}
            <strong>portable</strong> format; and{" "}
            <strong>withdraw consent</strong> where processing is based on it.
          </p>
          <p className="mt-2">
            You also have the right to{" "}
            <strong>complain to your data-protection supervisory authority</strong>{" "}
            (in the Netherlands, the Autoriteit Persoonsgegevens). To exercise
            any of these, contact{" "}
            <a href="mailto:Nowmatstudios@gmail.com" className="text-gold underline">
              Nowmatstudios@gmail.com
            </a>
            . We respond within the time the law requires (one month under the
            GDPR).
          </p>
        </Section>

        <Section title="7. Cookies and tracking">
          <p>
            We do <strong>not</strong> use advertising or third-party tracking
            cookies. Our analytics uses your browser's local storage (not a
            cookie), does not record your screen, and does not follow you across
            other websites.
          </p>
        </Section>

        <Section title="8. Children">
          <p>
            The game is intended for users aged <strong>13 and over</strong>. We
            do not knowingly collect data from children under 13. Note that in
            some countries the age at which a child can consent to data
            processing on their own is higher (16 in the Netherlands and parts
            of the EU); where that applies, a parent or guardian&rsquo;s consent
            is required. If you believe a child under the applicable age has
            given us their data, contact us and we will delete it.
          </p>
        </Section>

        <Section title="9. Security">
          <p>
            Passwords are stored hashed by Supabase Authentication, and data is
            transmitted over encrypted (HTTPS) connections. We continue to
            strengthen our safeguards as the game grows.
          </p>
        </Section>

        <Section title="10. Changes to this notice">
          <p>
            We may update this notice. The "last updated" date at the top shows
            the current version.
          </p>
        </Section>

        <Section title="11. Contact">
          <p>
            M.M. Ansinger (Nowmat Studios) —{" "}
            <a href="mailto:Nowmatstudios@gmail.com" className="text-gold underline">
              Nowmatstudios@gmail.com
            </a>
            .
          </p>
        </Section>

        <p className="mt-10 text-sm text-cream/60">
          <Link href="/" className="text-gold underline">
            ← Back to the game
          </Link>
        </p>
      </article>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold text-gold">{title}</h2>
      <div className="mt-2 space-y-2 text-cream/90">{children}</div>
    </section>
  );
}
