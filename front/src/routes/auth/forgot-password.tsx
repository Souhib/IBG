import { createFileRoute, Link } from "@tanstack/react-router"
import { motion } from "motion/react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import apiClient, { getApiErrorMessage } from "@/api/client"

export const Route = createFileRoute("/auth/forgot-password")({
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState("")
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setIsLoading(true)

    try {
      await apiClient({
        method: "POST",
        url: "/api/v1/auth/forgot-password",
        data: { email },
      })
      setSuccess(true)
    } catch (err) {
      setError(getApiErrorMessage(err, t("common.error")))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 25 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md space-y-8"
      >
        <div className="text-center">
          <h1 className="text-3xl font-bold">{t("auth.forgotPassword")}</h1>
          <p className="mt-2 text-muted-foreground">{t("auth.forgotPasswordDescription")}</p>
        </div>

        {success ? (
          <div className="rounded-md bg-primary/10 p-4 text-center">
            <p className="text-sm text-primary font-medium">{t("auth.resetEmailSent")}</p>
            <Link to="/auth/login" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
              {t("auth.backToLogin")}
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
            )}
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">
                {t("auth.email")}
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="you@example.com"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isLoading ? t("common.loading") : t("auth.sendResetLink")}
            </button>
            <p className="text-center text-sm text-muted-foreground">
              <Link to="/auth/login" className="font-medium text-primary hover:underline">
                {t("auth.backToLogin")}
              </Link>
            </p>
          </form>
        )}
      </motion.div>
    </div>
  )
}
