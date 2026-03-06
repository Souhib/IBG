import { Link } from "@tanstack/react-router"
import { BookOpen, Github, Heart, Linkedin, Mail, User } from "lucide-react"
import { useTranslation } from "react-i18next"
import { motion, useReducedMotion } from "motion/react"

function IslamicPattern() {
  return (
    <svg
      className="absolute inset-0 h-full w-full opacity-[0.03] dark:opacity-[0.04]"
      aria-hidden="true"
    >
      <defs>
        <pattern id="footer-geo" x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
          {/* 8-pointed star motif */}
          <path
            d="M30 5 L35 25 L55 30 L35 35 L30 55 L25 35 L5 30 L25 25 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.5"
          />
          <circle cx="30" cy="30" r="8" fill="none" stroke="currentColor" strokeWidth="0.3" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#footer-geo)" />
    </svg>
  )
}

export function Footer() {
  const { t } = useTranslation()
  const shouldReduceMotion = useReducedMotion()

  return (
    <footer className="relative mt-auto border-t bg-card/50 backdrop-blur-sm overflow-hidden">
      <IslamicPattern />

      {/* Decorative top edge — subtle gold line */}
      <div
        className="absolute top-0 inset-x-0 h-px"
        style={{
          background: "linear-gradient(90deg, transparent, var(--accent) 30%, var(--accent) 70%, transparent)",
          opacity: 0.3,
        }}
      />

      <div className="relative mx-auto max-w-7xl px-4 py-10">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1.5fr]">
          {/* Brand column */}
          <div>
            <Link to="/" className="inline-flex items-center gap-2.5 group">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
                <BookOpen className="h-4.5 w-4.5" />
              </div>
              <span className="text-lg font-bold tracking-tight text-foreground">
                Islamic Party Games
              </span>
            </Link>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground max-w-xs">
              {t("home.subtitle")}
            </p>
          </div>

          {/* Quick links */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70 mb-4">
              {t("nav.rooms") ? "Navigation" : "Navigation"}
            </h3>
            <nav className="flex flex-col gap-2.5">
              {[
                { to: "/rooms" as const, label: t("nav.rooms") },
                { to: "/challenges" as const, label: t("nav.challenges") },
                { to: "/leaderboard" as const, label: t("nav.leaderboard") },
                { to: "/about" as const, label: t("nav.about") },
              ].map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="text-sm text-muted-foreground transition-colors hover:text-primary w-fit"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Developer teaser — the "About" showcase */}
          <motion.div
            initial={shouldReduceMotion ? {} : { opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70 mb-4">
              {t("about.title")}
            </h3>
            <Link
              to="/about"
              className="group flex items-start gap-4 rounded-xl border border-border/50 bg-background/60 p-4 transition-all hover:border-primary/30 hover:shadow-md hover:shadow-primary/5"
            >
              <div className="relative shrink-0">
                <div className="absolute -inset-0.5 rounded-full bg-gradient-to-br from-primary/30 to-accent/20 opacity-0 blur-sm transition-opacity group-hover:opacity-100" />
                <img
                  src="/souhib.jpeg"
                  alt={t("about.name")}
                  className="relative h-12 w-12 rounded-full object-cover ring-1 ring-border"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                    {t("about.name")}
                  </span>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    {t("about.role")}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-2">
                  {t("about.projectDescription")}
                </p>
                <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  <User className="h-3 w-3" />
                  {t("nav.about")}
                  <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">&rarr;</span>
                </span>
              </div>
            </Link>

            {/* Social links */}
            <div className="mt-4 flex items-center gap-3">
              {[
                { href: "https://github.com/souhib", icon: Github, label: "GitHub" },
                { href: "https://www.linkedin.com/in/souhib/", icon: Linkedin, label: "LinkedIn" },
                { href: "mailto:souhib.t@icloud.com", icon: Mail, label: "Email" },
              ].map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target={link.href.startsWith("http") ? "_blank" : undefined}
                  rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                  aria-label={link.label}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/50 bg-background/60 text-muted-foreground transition-all hover:text-primary hover:border-primary/30 hover:shadow-sm"
                >
                  <link.icon className="h-3.5 w-3.5" />
                </a>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 flex flex-col items-center gap-3 border-t border-border/40 pt-6 sm:flex-row sm:justify-between">
          <p className="text-xs text-muted-foreground/60">
            &copy; {new Date().getFullYear()} IPG &mdash; Islamic Party Games
          </p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground/60">
            Made with <Heart className="h-3 w-3 text-destructive/60" aria-label="love" /> for the Ummah
          </p>
        </div>
      </div>
    </footer>
  )
}
