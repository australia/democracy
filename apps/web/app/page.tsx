import { BrandHeader } from "./components/header";
import { ComposeFlow } from "./compose-flow";

export default function HomePage() {
  return (
    <>
      <section className="hero-bg pb-20">
        <BrandHeader />
        <h1 className="font-display mt-6 px-6 text-center text-[44px] leading-[1.05] md:text-[56px]">
          Write to your representatives
        </h1>
        <div className="mt-12">
          <ComposeFlow />
        </div>
      </section>

      <section className="bg-white py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="font-display text-3xl">Why we built Democracy.au</h2>
          <p className="mt-6 text-neutral-700">
            The federal Parliament publishes 225 contact pages — one per MP and
            Senator — but no central inbox. Democracy.au looks up the MP for your
            electorate and the senators for your state, then delivers a single
            message to each of their official channels.
          </p>
          <p className="mt-4 text-neutral-700">
            Non-partisan. Open source. The roster is scraped daily from the
            Parliament of Australia; electorate boundaries come from the
            Australian Electoral Commission.
          </p>
        </div>
      </section>
    </>
  );
}
