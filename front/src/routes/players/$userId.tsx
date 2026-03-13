import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Award, BarChart3, Check, Clock, Gamepad2, Heart, UserMinus, UserPlus } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { getApiErrorMessage } from "@/api/client"
import {
  useGetPublicProfileApiV1ProfilesUsersUserIdGet,
  useGetFriendshipStatusApiV1FriendsStatusUserIdGet,
  useSendFriendRequestApiV1FriendsRequestPost,
  useRemoveFriendApiV1FriendsFriendshipIdDelete,
  getFriendshipStatusApiV1FriendsStatusUserIdGetQueryKey,
} from "@/api/generated"
import type { PublicProfile } from "@/api/generated"
import { useAuth } from "@/providers/AuthProvider"

export const Route = createFileRoute("/players/$userId")({
  component: PlayerProfilePage,
})

const GAME_NAME_KEYS: Record<string, string> = {
  undercover: "games.undercover.name",
  codenames: "games.codenames.name",
  word_quiz: "games.wordQuiz.name",
}

function PlayerProfilePage() {
  const { userId } = Route.useParams()
  const { t } = useTranslation()
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const isOwnProfile = user?.id === userId

  const { data: profile, isLoading, error: queryError } = useGetPublicProfileApiV1ProfilesUsersUserIdGet(
    { user_id: userId },
  ) as { data: PublicProfile | undefined; isLoading: boolean; error: Error | null }

  const error = queryError ? getApiErrorMessage(queryError, t("common.error")) : null

  const { data: friendshipStatus } = useGetFriendshipStatusApiV1FriendsStatusUserIdGet(
    { user_id: userId },
    { query: { enabled: !!user?.id && !isOwnProfile } },
  )

  const sendRequestMutation = useSendFriendRequestApiV1FriendsRequestPost()
  const removeFriendMutation = useRemoveFriendApiV1FriendsFriendshipIdDelete()

  const invalidateFriendshipStatus = () => {
    queryClient.invalidateQueries({
      queryKey: getFriendshipStatusApiV1FriendsStatusUserIdGetQueryKey({ user_id: userId }),
    })
  }

  const handleAddFriend = async () => {
    if (sendRequestMutation.isPending) return
    try {
      await sendRequestMutation.mutateAsync({ data: { addressee_id: userId } })
      toast.success(t("friends.requestSent"))
      invalidateFriendshipStatus()
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    }
  }

  const handleRemoveFriend = async () => {
    if (removeFriendMutation.isPending || !friendshipStatus?.friendship_id) return
    try {
      await removeFriendMutation.mutateAsync({ friendship_id: friendshipStatus.friendship_id })
      toast.success(t("friends.friendRemoved"))
      invalidateFriendshipStatus()
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">{t("common.loading")}</p>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8">
        <div className="glass rounded-2xl border border-destructive/30 p-6 text-center text-destructive">
          {error ?? t("common.error")}
        </div>
      </div>
    )
  }

  const status = friendshipStatus?.status

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      {/* Profile Header */}
      <div className="glass rounded-2xl border border-border/30 p-8 mb-8 animate-scale-in">
        <div className="flex items-center gap-5">
          {/* Avatar with gradient ring */}
          <div className="relative shrink-0">
            <div className="absolute -inset-1 rounded-full bg-gradient-to-br from-primary via-accent to-primary opacity-70 blur-sm" />
            <div className="absolute -inset-0.5 rounded-full bg-gradient-to-br from-primary via-accent to-primary opacity-90" />
            <div className="relative flex h-18 w-18 items-center justify-center rounded-full bg-background text-2xl font-extrabold text-primary ring-2 ring-background">
              {profile.username.charAt(0).toUpperCase()}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl font-extrabold tracking-tight gradient-text">{profile.username}</h1>
            {profile.bio && (
              <p className="mt-1.5 text-muted-foreground">{profile.bio}</p>
            )}
          </div>
          {!isOwnProfile && user && (
            <>
              {status === "none" && (
                <button
                  type="button"
                  onClick={handleAddFriend}
                  disabled={sendRequestMutation.isPending}
                  className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-primary to-primary/90 px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50"
                >
                  <UserPlus className="h-4 w-4" />
                  {t("friends.addFriend")}
                </button>
              )}
              {status === "pending_sent" && (
                <span className="flex items-center gap-2 rounded-2xl bg-muted px-5 py-2.5 text-sm font-semibold text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  {t("stats.pending")}
                </span>
              )}
              {status === "pending_received" && (
                <button
                  type="button"
                  onClick={handleAddFriend}
                  disabled={sendRequestMutation.isPending}
                  className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-primary to-primary/90 px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50"
                >
                  <Check className="h-4 w-4" />
                  {t("friends.accept")}
                </button>
              )}
              {status === "accepted" && (
                <button
                  type="button"
                  onClick={handleRemoveFriend}
                  disabled={removeFriendMutation.isPending}
                  className="flex items-center gap-2 rounded-2xl bg-destructive/10 px-5 py-2.5 text-sm font-semibold text-destructive hover:bg-destructive/20 transition-all duration-200 disabled:opacity-50"
                >
                  <UserMinus className="h-4 w-4" />
                  {t("friends.removeFriend")}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {[
          { value: profile.total_games_played, label: t("stats.gamesPlayed"), delay: 0 },
          { value: profile.undercover_games_played, label: t("stats.undercoverPlayed"), delay: 0.05 },
          { value: profile.codenames_games_played, label: t("stats.codenamesPlayed"), delay: 0.1 },
          { value: profile.wordquiz_games_played, label: t("stats.wordquizPlayed"), delay: 0.15 },
        ].map((stat) => (
          <div
            key={stat.label}
            className="glass rounded-2xl border border-border/30 p-5 text-center hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 animate-slide-up"
          >
            <p className="text-3xl font-extrabold tracking-tight font-mono tabular-nums gradient-text">{stat.value}</p>
            <p className="text-sm text-muted-foreground mt-1 font-medium">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Favorite Game */}
      {profile.favorite_game && (
        <div className="glass rounded-2xl border border-border/30 p-6 mb-8 animate-slide-up">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-accent/10 p-2.5">
              <Heart className="h-5 w-5 text-accent" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground font-medium">{t("stats.favoriteGame")}</p>
              <p className="text-lg font-extrabold tracking-tight">
                {t(GAME_NAME_KEYS[profile.favorite_game] ?? profile.favorite_game)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Quick Links */}
      {isOwnProfile && (
        <div className="grid gap-4 md:grid-cols-3">
          <Link
            to="/stats"
            className="glass rounded-2xl border border-border/30 p-7 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 group"
          >
            <div className="rounded-2xl bg-primary/10 p-3 w-fit mb-4 group-hover:bg-primary/15 transition-colors duration-200">
              <BarChart3 className="h-7 w-7 text-primary" />
            </div>
            <h3 className="font-extrabold tracking-tight">{t("stats.title")}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{t("profile.viewStats")}</p>
          </Link>

          <Link
            to="/achievements"
            className="glass rounded-2xl border border-border/30 p-7 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 group"
          >
            <div className="rounded-2xl bg-accent/10 p-3 w-fit mb-4 group-hover:bg-accent/15 transition-colors duration-200">
              <Award className="h-7 w-7 text-accent" />
            </div>
            <h3 className="font-extrabold tracking-tight">{t("achievements.title")}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{t("profile.viewAchievements")}</p>
          </Link>

          <Link
            to="/rooms"
            className="glass rounded-2xl border border-border/30 p-7 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 group"
          >
            <div className="rounded-2xl bg-primary/10 p-3 w-fit mb-4 group-hover:bg-primary/15 transition-colors duration-200">
              <Gamepad2 className="h-7 w-7 text-primary" />
            </div>
            <h3 className="font-extrabold tracking-tight">{t("nav.rooms")}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{t("profile.joinOrCreate")}</p>
          </Link>
        </div>
      )}
    </div>
  )
}
