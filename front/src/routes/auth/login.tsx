import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { motion } from "motion/react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import apiClient, { getApiErrorMessage } from "@/api/client"
import { useAuth } from "@/providers/AuthProvider"

export const Route = createFileRoute("/auth/login")({
  component: LoginPage,
})

function LoginPage() {
  const { t } = useTranslation()
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setIsLoading(true)

    try {
      const response = await apiClient({
        method: "POST",
        url: "/api/v1/auth/login",
        data: { email, password },
      })

      const data = response.data as {
        access_token: string
        refresh_token: string
        token_type: string
        user: { id: string; username: string; email: string }
      }

      login(data.access_token, data.refresh_token, 900, {
        id: data.user.id,
        username: data.user.username,
        email: data.user.email,
        is_active: true,
        is_admin: false,
      })
      navigate({ to: "/" })
    } catch (err) {
      setError(getApiErrorMessage(err, t("errors.api.invalidCredentials")))
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
          <h1 className="text-3xl font-bold">{t("auth.loginTitle")}</h1>
          <p className="mt-2 text-muted-foreground">{t("auth.loginDescription")}</p>
        </div>

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

          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-1">
              {t("auth.password")}
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="********"
            />
          </div>

          <div className="flex justify-end">
            <Link to="/auth/forgot-password" className="text-sm text-muted-foreground hover:text-primary hover:underline transition-colors">
              {t("auth.forgotPassword")}
            </Link>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isLoading ? t("common.loading") : t("auth.login")}
          </button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          {t("auth.noAccount")}{" "}
          <Link to="/auth/register" className="font-medium text-primary hover:underline">
            {t("auth.register")}
          </Link>
        </p>
      </motion.div>
    </div>
  )
}
