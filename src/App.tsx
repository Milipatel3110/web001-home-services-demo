import { Hammer, Home, Info, Sofa, Wrench } from "lucide-react";

import { ContactForm } from "@/components/ContactForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const SERVICES = [
  {
    title: "Small Repairs",
    description: "Fixing squeaky doors, loose handles, minor wall patches and other everyday fixes.",
    icon: Hammer,
  },
  {
    title: "Furniture Assembly",
    description: "Putting together flat-pack shelves, desks, beds and wardrobes neatly and safely.",
    icon: Sofa,
  },
  {
    title: "Home Maintenance",
    description: "Routine checks and upkeep such as sealant touch-ups, filter changes and gutter checks.",
    icon: Wrench,
  },
] as const;

function DemoNotice() {
  return (
    <div role="note" aria-label="Demonstration notice" className="border-b border-amber-300 bg-amber-100 text-amber-950">
      <p className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-3 text-center text-sm font-semibold sm:text-base">
        <Info className="size-5 shrink-0" aria-hidden="true" />
        Demonstration only — no services offered
      </p>
    </div>
  );
}

export default function App() {
  return (
    <>
      <a
        href="#main"
        className="focus:bg-primary focus:text-primary-foreground sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <DemoNotice />

      <header className="border-b bg-white/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <a href="#main" className="flex items-center gap-2 font-semibold">
            <Home className="text-primary size-5" aria-hidden="true" />
            Sample Home Services
          </a>
          <nav aria-label="Primary">
            <ul className="flex gap-1 text-sm">
              <li>
                <Button asChild variant="ghost" size="sm">
                  <a href="#services">Services</a>
                </Button>
              </li>
              <li>
                <Button asChild variant="ghost" size="sm">
                  <a href="#contact">Contact</a>
                </Button>
              </li>
            </ul>
          </nav>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="outline-none">
        <section aria-labelledby="hero-title" className="from-primary/10 to-background bg-gradient-to-b">
          <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:py-24">
            <h1 id="hero-title" className="text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              Sample Home Services — Demo
            </h1>
            <p className="text-muted-foreground mx-auto mt-6 max-w-2xl text-lg text-pretty">
              A sample website showing how a small home-services business could present repairs, assembly and
              maintenance work online.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <a href="#contact">Contact Us</a>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="#services">View services</a>
              </Button>
            </div>
          </div>
        </section>

        <section id="services" aria-labelledby="services-title" className="scroll-mt-4">
          <div className="mx-auto max-w-6xl px-4 py-16">
            <h2 id="services-title" className="text-3xl font-bold tracking-tight">
              Services
            </h2>
            <p className="text-muted-foreground mt-2">Example services for demonstration purposes.</p>
            <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {SERVICES.map(({ title, description, icon: Icon }) => (
                <li key={title}>
                  <Card className="h-full">
                    <CardHeader>
                      <span className="bg-primary/10 text-primary mb-2 inline-flex size-11 items-center justify-center rounded-lg">
                        <Icon className="size-6" aria-hidden="true" />
                      </span>
                      <CardTitle className="text-xl">{title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <CardDescription className="text-base">{description}</CardDescription>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="contact" aria-labelledby="contact-title" className="bg-secondary/60 scroll-mt-4 border-t">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <h2 id="contact-title" className="text-3xl font-bold tracking-tight">
                Contact
              </h2>
              <p className="text-muted-foreground mt-3">
                Send a message using the form. This is a demonstration site — no services are offered and no one will
                be dispatched.
              </p>
            </div>
            <Card>
              <CardContent>
                <ContactForm />
              </CardContent>
            </Card>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <p className="text-muted-foreground mx-auto max-w-6xl px-4 py-6 text-center text-sm">
          © {new Date().getFullYear()} Sample Home Services — Demo. Demonstration only — no services offered.
        </p>
      </footer>
    </>
  );
}
