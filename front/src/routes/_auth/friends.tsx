import { createFileRoute, Link } from "@tanstack/react-router"
import { Check, Clock, Search, UserMinus, UserPlus, Users, X } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import apiClient, { getApiErrorMessage } from "@/api/client"
import { useAuth } from "@/providers/AuthProvider"
import { cn } from "@/lib/utils"

interface FriendEntry {
  friendship_id: string
  user_id: string
  username: string
  status: string
}

type Tab = "friends" | "pending"

export const Route = createFileRoute("/_auth/friends")({
  component: FriendsPage,
})

function FriendsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>("friends")
  const [friends, setFriends] = useState<FriendEntry[]>([])
  const [pending, setPending] = useState<FriendEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")

  const fetchFriends = () => {
    if (!user) return
    setIsLoading(true)
    Promise.all([
      apiClient({ method: "GET", url: "/api/v1/friends" }).then((r) => r.data as FriendEntry[]),
      apiClient({ method: "GET", url: "/api/v1/friends/pending" }).then((r) => r.data as FriendEntry[]),
    ])
      .then(([f, p]) => {
        setFriends(f)
        setPending(p)
      })
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }

  useEffect(() => {
    fetchFriends()
  }, [user])

  const handleAccept = async (friendshipId: string) => {
    try {
      await apiClient({ method: "POST", url: `/api/v1/friends/${friendshipId}/accept` })
      toast.success(t("friends.requestAccepted"))
      fetchFriends()
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    }
  }

  const handleReject = async (friendshipId: string) => {
    try {
      await apiClient({ method: "POST", url: `/api/v1/friends/${friendshipId}/reject` })
      toast.success(t("friends.requestRejected"))
      fetchFriends()
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    }
  }

  const handleRemove = async (friendshipId: string) => {
    try {
      await apiClient({ method: "DELETE", url: `/api/v1/friends/${friendshipId}` })
      toast.success(t("friends.friendRemoved"))
      fetchFriends()
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    }
  }

  const filteredFriends = friends.filter((f) =>
    f.username.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex items-center gap-3 mb-8">
        <Users className="h-8 w-8 text-primary" />
        <h1 className="text-3xl font-bold">{t("friends.title")}</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          type="button"
          onClick={() => setTab("friends")}
          className={cn(
            "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
            tab === "friends"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80",
          )}
        >
          <Users className="h-4 w-4" />
          {t("friends.myFriends")} ({friends.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("pending")}
          className={cn(
            "relative flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
            tab === "pending"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80",
          )}
        >
          <Clock className="h-4 w-4" />
          {t("friends.pendingRequests")}
          {pending.length > 0 && (
            <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
              {pending.length}
            </span>
          )}
        </button>
      </div>

      {tab === "friends" && (
        <>
          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("friends.searchPlaceholder")}
              className="w-full rounded-md border bg-background py-2 pl-10 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Friends List */}
          <div className="rounded-xl border bg-card overflow-hidden">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">{t("common.loading")}</div>
            ) : filteredFriends.length === 0 ? (
              <div className="p-8 text-center">
                <UserPlus className="mx-auto h-12 w-12 text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground">
                  {searchQuery ? t("friends.noResults") : t("friends.noFriends")}
                </p>
              </div>
            ) : (
              <div className="divide-y">
                {filteredFriends.map((friend) => (
                  <div key={friend.friendship_id} className="flex items-center justify-between px-4 py-3">
                    <Link
                      to="/players/$userId"
                      params={{ userId: friend.user_id }}
                      className="flex items-center gap-3 hover:opacity-80 transition-opacity"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                        {friend.username.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium">{friend.username}</span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleRemove(friend.friendship_id)}
                      className="rounded-md p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      aria-label={t("friends.removeFriend")}
                    >
                      <UserMinus className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === "pending" && (
        <div className="rounded-xl border bg-card overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">{t("common.loading")}</div>
          ) : pending.length === 0 ? (
            <div className="p-8 text-center">
              <Clock className="mx-auto h-12 w-12 text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground">{t("friends.noPending")}</p>
            </div>
          ) : (
            <div className="divide-y">
              {pending.map((request) => (
                <div key={request.friendship_id} className="flex items-center justify-between px-4 py-3">
                  <Link
                    to="/players/$userId"
                    params={{ userId: request.user_id }}
                    className="flex items-center gap-3 hover:opacity-80 transition-opacity"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {request.username.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-medium">{request.username}</span>
                  </Link>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleAccept(request.friendship_id)}
                      className="rounded-md p-2 text-primary hover:bg-primary/10 transition-colors"
                      aria-label={t("friends.accept")}
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReject(request.friendship_id)}
                      className="rounded-md p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      aria-label={t("friends.reject")}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
