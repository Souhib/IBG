import { createFileRoute, Link, useSearch } from "@tanstack/react-router"
import { motion } from "motion/react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import apiClient, { getApiErrorMessage } from "@/api/client"

export const Route = createFileRoute("/auth/verify-email")({
  component: VerifyEmailPage,
  validateSearch: (search: Record<string, unknown>) => ({
    token: (search.token as string) || "",
  }),
})

function VerifyEmailPage() {
  const { t } = useTranslation()
  const { token } = useSearch({ from: "/auth/verify-email" })
  const [status, setStatus] = useState<"loading" | "success" | "error">(token ? "loading" : "error")
  const [error, setError] = useState("")

  useEffect(() => {
    if (!token) {
      setStatus("error")
      setError(t("auth.invalidOrExpiredToken"))
      return
    }

    const verify = async () => {
      try {
        await apiClient({
          method: "POST",
          url: "/api/v1/auth/verify-email",
          data: { token },
        })
        setStatus("success")
      } catch (err) {
        setStatus("error")
        setError(getApiErrorMessage(err, t("auth.invalidOrExpiredToken")))
      }
    }

    verify()
  }, [token, t])

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 25 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md space-y-6 text-center"
      >
        {status === "loading" && (
          <>
            <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            <p className="text-muted-foreground">{t("auth.verifyingEmail")}</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <svg className="h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold">{t("auth.emailVerified")}</h1>
            <p className="text-muted-foreground">{t("auth.emailVerifiedDescription")}</p>
            <Link
              to="/auth/login"
              className="inline-block rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {t("auth.login")}
            </Link>
          </>
        )}

        {status === "error" && (
          <>
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <svg className="h-8 w-8 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-destructive">{t("auth.verificationFailed")}</h1>
            <p className="text-muted-foreground">{error}</p>
            <Link
              to="/auth/login"
              className="inline-block text-sm font-medium text-primary hover:underline"
            >
              {t("auth.backToLogin")}
            </Link>
          </>
        )}
      </motion.div>
    </div>
  )
}
