import { createFileRoute } from '@tanstack/react-router'
import { motion, useInView } from 'motion/react'
import {
  Briefcase,
  Code2,
  GraduationCap,
  Heart,
  Linkedin,
  Github,
  Mail,
  Phone,
  Sparkles,
} from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/about')({
  component: AboutPage,
})

function Section({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode
  delay?: number
  className?: string
}) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-60px' })

  return (
    <motion.section
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.section>
  )
}

const skills = [
  'Python',
  'FastAPI',
  'Flask',
  'React',
  'TypeScript',
  'PostgreSQL',
  'MySQL',
  'AWS',
  'GCP',
  'Docker',
  'Terraform',
  'Ansible',
  'Gitlab CI/CD',
  'Traefik',
  'Prefect',
  'SQLModel',
  'Tailwind CSS',
  'OpenCV',
  'Pandas',
  'NumPy',
  'Scikit-learn',
]

function AboutPage() {
  const { t } = useTranslation()

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 space-y-16">
      {/* ── Hero ── */}
      <Section className="flex flex-col items-center gap-6 sm:flex-row sm:gap-10">
        <motion.div
          className="relative shrink-0"
          whileHover={{ scale: 1.04 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          <div className="absolute -inset-1 rounded-full bg-gradient-to-br from-primary/40 via-accent/30 to-primary/20 blur-md" />
          <img
            src="/souhib.jpeg"
            alt={t('about.name')}
            className="relative h-40 w-40 rounded-full object-cover ring-2 ring-primary/30 sm:h-48 sm:w-48"
          />
        </motion.div>

        <div className="text-center sm:text-start">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {t('about.name')}
          </h1>
          <p className="mt-1 text-lg font-medium text-primary">
            {t('about.role')}
          </p>
          <p className="mt-4 max-w-xl text-muted-foreground leading-relaxed">
            {t('about.bio')}
          </p>
        </div>
      </Section>

      {/* ── Project Purpose ── */}
      <Section delay={0.1}>
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-semibold">{t('about.projectPurpose')}</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            {t('about.projectDescription')}
          </p>
        </div>
      </Section>

      {/* ── Education ── */}
      <Section delay={0.1}>
        <div className="flex items-center gap-3 mb-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <GraduationCap className="h-5 w-5" />
          </div>
          <h2 className="text-xl font-semibold">{t('about.education')}</h2>
        </div>
        <div className="space-y-3">
          {(['educationEpitech', 'educationSfsu'] as const).map((key, i) => (
            <motion.div
              key={key}
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.5 }}
              className="rounded-lg border bg-card p-4"
            >
              <p className="font-medium">{t(`about.${key}`)}</p>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ── Experience ── */}
      <Section delay={0.1}>
        <div className="flex items-center gap-3 mb-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Briefcase className="h-5 w-5" />
          </div>
          <h2 className="text-xl font-semibold">{t('about.experience')}</h2>
        </div>
        <div className="space-y-3">
          {([
            'experienceMadura',
            'experienceSnap',
            'experienceEnedis',
            'experienceBnp',
            'experienceCloudeasier',
          ] as const).map(
            (key, i) => (
              <motion.div
                key={key}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
                className="rounded-lg border bg-card p-4"
              >
                <p className="font-medium">{t(`about.${key}Title`)}</p>
                <p className="text-sm text-muted-foreground mt-1">{t(`about.${key}Period`)}</p>
                <p className="text-sm text-muted-foreground mt-1">{t(`about.${key}Desc`)}</p>
              </motion.div>
            ),
          )}
        </div>
      </Section>

      {/* ── Skills ── */}
      <Section delay={0.1}>
        <div className="flex items-center gap-3 mb-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Code2 className="h-5 w-5" />
          </div>
          <h2 className="text-xl font-semibold">{t('about.skills')}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {skills.map((skill, i) => (
            <motion.span
              key={skill}
              initial={{ opacity: 0, scale: 0.7 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{
                type: 'spring',
                stiffness: 400,
                damping: 15,
                delay: i * 0.04,
              }}
              whileHover={{ scale: 1.08, y: -2 }}
              className="rounded-full border bg-secondary/60 px-3.5 py-1.5 text-sm font-medium text-secondary-foreground"
            >
              {skill}
            </motion.span>
          ))}
        </div>
      </Section>

      {/* ── Free Mentoring ── */}
      <Section delay={0.1}>
        <motion.div
          className="relative overflow-hidden rounded-xl border-2 border-accent/40 bg-accent/5 p-6"
          animate={{
            borderColor: [
              'oklch(0.72 0.14 65 / 0.4)',
              'oklch(0.72 0.14 65 / 0.7)',
              'oklch(0.72 0.14 65 / 0.4)',
            ],
          }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/15 text-accent-foreground">
              <Heart className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-semibold">{t('about.mentoringTitle')}</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            {t('about.mentoringText')}
          </p>

          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href="mailto:souhib.t@icloud.com"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Mail className="h-4 w-4" />
              souhib.t@icloud.com
            </a>
            <a
              href="tel:+33643142020"
              className="inline-flex items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary"
            >
              <Phone className="h-4 w-4" />
              +33 6 43 14 20 20
            </a>
          </div>
        </motion.div>
      </Section>

      {/* ── Contact ── */}
      <Section delay={0.1} className="pb-8">
        <h2 className="text-xl font-semibold mb-5">{t('about.contactMe')}</h2>
        <div className="flex flex-wrap gap-3">
          {[
            {
              href: 'mailto:souhib.t@icloud.com',
              icon: Mail,
              label: 'Email',
            },
            {
              href: 'tel:+33643142020',
              icon: Phone,
              label: 'Phone',
            },
            {
              href: 'https://www.linkedin.com/in/souhib-trabelsi/',
              icon: Linkedin,
              label: 'LinkedIn',
            },
            {
              href: 'https://github.com/Souhib',
              icon: Github,
              label: 'GitHub',
            },
          ].map((link) => (
            <motion.a
              key={link.label}
              href={link.href}
              target={link.href.startsWith('http') ? '_blank' : undefined}
              rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
              whileHover={{ scale: 1.06, y: -2 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}
              className="inline-flex items-center gap-2 rounded-lg border bg-card px-5 py-2.5 text-sm font-medium shadow-sm transition-colors hover:bg-secondary hover:border-primary/30"
            >
              <link.icon className="h-4 w-4 text-primary" />
              {link.label}
            </motion.a>
          ))}
        </div>
      </Section>
    </div>
  )
}
