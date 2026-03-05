import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Crown, Loader2, LogOut, MessageCircle, Shield, Skull, ThumbsUp, User } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import apiClient, { getApiErrorMessage } from "@/api/client"
import { useAuth } from "@/providers/AuthProvider"
import { cn } from "@/lib/utils"

interface UndercoverPlayer {
  id: string
  username: string
  is_alive: boolean
  is_mayor?: boolean
  role?: string
}

interface DescriptionOrderEntry {
  user_id: string
  username: string
}

interface GameState {
  players: UndercoverPlayer[]
  phase: "role_reveal" | "describing" | "playing" | "elimination" | "game_over"
  round: number
  my_role?: string
  my_word?: string
  eliminated_player_username?: string
  eliminated_player_role?: string
  winner?: string
  votedPlayers: string[]
  isHost: boolean
  descriptionOrder: DescriptionOrderEntry[]
  currentDescriberIndex: number
  descriptions: Record<string, string>
}

export const Route = createFileRoute("/_auth/game/undercover/$gameId")({
  component: UndercoverGamePage,
})

function UndercoverGamePage() {
  const { gameId } = Route.useParams()
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const roomIdRef = useRef<string | null>(null)
  const [roleRevealed, setRoleRevealed] = useState(false)
  const [selectedVote, setSelectedVote] = useState<string | null>(null)
  const [descriptionInput, setDescriptionInput] = useState("")
  const [descriptionError, setDescriptionError] = useState("")
  const [isSubmittingDescription, setIsSubmittingDescription] = useState(false)
  const [showVotingTransition, setShowVotingTransition] = useState(false)
  const votingTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previousPhaseRef = useRef<string | null>(null)
  const previousRoundRef = useRef<number>(0)
  const [cancelMessage, setCancelMessage] = useState<string | null>(null)

  // Poll game state via REST every 2 seconds
  const { data: serverState, isLoading, error: queryError } = useQuery({
    queryKey: ["undercover", gameId],
    queryFn: async () => {
      const res = await apiClient({
        method: "GET",
        url: `/api/v1/undercover/games/${gameId}/state`,
      })
      return res.data as {
        my_role: string
        my_word: string
        is_alive: boolean
        players: { user_id: string; username: string; is_alive: boolean; is_mayor?: boolean }[]
        eliminated_players: { user_id: string; username: string; role: string }[]
        turn_number: number
        has_voted: boolean
        room_id?: string
        is_host?: boolean
        votes?: Record<string, string>
        winner?: string | null
        turn_phase?: string
        description_order?: DescriptionOrderEntry[]
        current_describer_index?: number
        descriptions?: Record<string, string>
      }
    },
    refetchInterval: 2000,
    refetchOnWindowFocus: true,
    enabled: !!user,
  })

  // Derive game state from server data
  const gameState = useMemo<GameState>(() => {
    if (!serverState) {
      return {
        players: [],
        phase: "role_reveal",
        round: 1,
        votedPlayers: [],
        isHost: false,
        descriptionOrder: [],
        currentDescriberIndex: 0,
        descriptions: {},
      }
    }

    if (serverState.room_id) roomIdRef.current = serverState.room_id

    const votedPlayerIds = serverState.votes ? Object.keys(serverState.votes) : []

    let phase: GameState["phase"]
    if (serverState.winner) {
      phase = "game_over"
    } else if (serverState.turn_phase === "describing") {
      phase = roleRevealed || serverState.turn_number > 1 ? "describing" : "role_reveal"
    } else if (serverState.turn_number > 0) {
      phase = "playing"
    } else {
      phase = "role_reveal"
    }

    // Detect elimination: if phase just changed from voting to describing and there's a newly eliminated player
    const prevPhase = previousPhaseRef.current
    const lastEliminated = serverState.eliminated_players.length > 0
      ? serverState.eliminated_players[serverState.eliminated_players.length - 1]
      : null

    let eliminated_player_username: string | undefined
    let eliminated_player_role: string | undefined

    if (prevPhase === "playing" && serverState.turn_phase === "describing" && lastEliminated) {
      eliminated_player_username = lastEliminated.username
      eliminated_player_role = lastEliminated.role
    }

    return {
      players: serverState.players.map((p) => ({
        id: p.user_id,
        username: p.username,
        is_alive: p.is_alive,
        is_mayor: p.is_mayor,
      })),
      phase,
      round: serverState.turn_number,
      my_role: serverState.my_role,
      my_word: serverState.my_word,
      eliminated_player_username,
      eliminated_player_role,
      winner: serverState.winner || undefined,
      votedPlayers: votedPlayerIds,
      isHost: serverState.is_host ?? false,
      descriptionOrder: serverState.description_order || [],
      currentDescriberIndex: serverState.current_describer_index ?? 0,
      descriptions: serverState.descriptions || {},
    }
  }, [serverState, roleRevealed])

  // Track phase changes for transitions
  useEffect(() => {
    if (!serverState) return
    const currentPhase = serverState.turn_phase
    const currentRound = serverState.turn_number

    // Reset state on new round
    if (currentRound > previousRoundRef.current && previousRoundRef.current > 0) {
      setSelectedVote(null)
      setDescriptionInput("")
      setDescriptionError("")
      setIsSubmittingDescription(false)
      if (votingTransitionTimerRef.current) {
        clearTimeout(votingTransitionTimerRef.current)
        votingTransitionTimerRef.current = null
        setShowVotingTransition(false)
      }
    }

    // Show voting transition when descriptions complete
    if (previousPhaseRef.current === "describing" && currentPhase === "voting" && !showVotingTransition) {
      setShowVotingTransition(true)
      votingTransitionTimerRef.current = setTimeout(() => {
        setShowVotingTransition(false)
        votingTransitionTimerRef.current = null
      }, 2500)
    }

    previousPhaseRef.current = currentPhase || null
    previousRoundRef.current = currentRound
  }, [serverState])

  // Handle query error (game not found)
  useEffect(() => {
    if (queryError) {
      const errMsg = getApiErrorMessage(queryError, "Game not found")
      if (errMsg.includes("not found") || errMsg.includes("removed")) {
        setCancelMessage(errMsg)
        setTimeout(() => navigate({ to: "/" }), 3000)
      }
    }
  }, [queryError, navigate])

  // Derive hasVoted from server-authoritative votedPlayers list
  const hasVoted = useMemo(() => {
    if (!user) return false
    return gameState.votedPlayers.includes(user.id)
  }, [gameState.votedPlayers, user])

  const handleSelectPlayer = useCallback(
    (playerId: string) => {
      if (hasVoted) return
      setSelectedVote((prev) => (prev === playerId ? null : playerId))
    },
    [hasVoted],
  )

  const handleConfirmVote = useCallback(async () => {
    if (!selectedVote || hasVoted || !user) return
    const votedPlayer = gameState.players.find((p) => p.id === selectedVote)
    if (votedPlayer) {
      toast.info(t("game.undercover.votedFor", { username: votedPlayer.username }))
    }
    try {
      await apiClient({
        method: "POST",
        url: `/api/v1/undercover/games/${gameId}/vote`,
        data: { voted_for: selectedVote },
      })
      queryClient.invalidateQueries({ queryKey: ["undercover", gameId] })
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to submit vote"))
    }
  }, [selectedVote, hasVoted, gameId, user, gameState.players, t, queryClient])

  const handleSubmitDescription = useCallback(async () => {
    if (!user || isSubmittingDescription) return
    const word = descriptionInput.trim()
    if (!word) {
      setDescriptionError(t("game.undercover.wordMustBeSingleWord"))
      return
    }
    if (word.includes(" ")) {
      setDescriptionError(t("game.undercover.wordMustBeSingleWord"))
      return
    }
    if (word.length > 50) {
      setDescriptionError(t("game.undercover.wordMustBeSingleWord"))
      return
    }
    setDescriptionError("")
    setIsSubmittingDescription(true)
    try {
      await apiClient({
        method: "POST",
        url: `/api/v1/undercover/games/${gameId}/describe`,
        data: { word },
      })
      setDescriptionInput("")
      queryClient.invalidateQueries({ queryKey: ["undercover", gameId] })
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to submit description"))
    } finally {
      setIsSubmittingDescription(false)
    }
  }, [descriptionInput, user, gameId, isSubmittingDescription, t, queryClient])

  const handleNextRound = useCallback(async () => {
    if (!roomIdRef.current) return
    try {
      await apiClient({
        method: "POST",
        url: `/api/v1/undercover/games/${gameId}/next-round`,
        data: { room_id: roomIdRef.current },
      })
      queryClient.invalidateQueries({ queryKey: ["undercover", gameId] })
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to start next round"))
    }
  }, [gameId, queryClient])

  const handleDismissRole = useCallback(() => {
    setRoleRevealed(true)
  }, [])

  const handleLeaveRoom = useCallback(async () => {
    if (!user || !roomIdRef.current) {
      navigate({ to: "/rooms" })
      return
    }
    try {
      await apiClient({
        method: "PATCH",
        url: "/api/v1/rooms/leave",
        data: { user_id: user.id, room_id: roomIdRef.current },
      })
    } catch {
      // Ignore errors — navigate anyway
    }
    toast.info(t("toast.youLeftRoom"))
    navigate({ to: "/rooms" })
  }, [user, navigate, t])

  const myPlayer = gameState.players.find((p) => p.id === user?.id)
  const isAlive = myPlayer?.is_alive !== false

  // Check if it's my turn to describe
  const isMyTurnToDescribe =
    gameState.phase === "describing" &&
    gameState.descriptionOrder.length > 0 &&
    gameState.currentDescriberIndex < gameState.descriptionOrder.length &&
    gameState.descriptionOrder[gameState.currentDescriberIndex]?.user_id === user?.id

  // Current describer info
  const currentDescriber =
    gameState.descriptionOrder.length > 0 && gameState.currentDescriberIndex < gameState.descriptionOrder.length
      ? gameState.descriptionOrder[gameState.currentDescriberIndex]
      : null

  if (cancelMessage) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="rounded-xl border bg-destructive/10 p-8 text-center">
          <h2 className="text-xl font-bold text-destructive mb-2">{t("game.gameOver")}</h2>
          <p className="text-muted-foreground">{cancelMessage}</p>
          <p className="text-sm text-muted-foreground mt-2">Redirecting...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {/* Voting Transition Overlay */}
      <AnimatePresence>
        {showVotingTransition && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm"
          >
            <motion.div className="text-center space-y-4">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", delay: 0.2 }}
              >
                <MessageCircle className="h-16 w-16 mx-auto text-primary" />
              </motion.div>
              <motion.h2
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="text-2xl font-bold"
              >
                {t("game.undercover.allDescriptionsIn")}
              </motion.h2>
              <motion.p
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.7 }}
                className="text-lg text-muted-foreground"
              >
                {t("game.undercover.timeToVote")}
              </motion.p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Game Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold">{t("games.undercover.name")}</h1>
        <p className="text-sm text-muted-foreground mt-1">Round {gameState.round}</p>
      </div>

      {/* Loading State */}
      {isLoading && !gameState.my_role && (
        <div className="rounded-xl border bg-card p-8 text-center mb-8">
          <Loader2 className="h-10 w-10 mx-auto animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">{t("common.loading")}</p>
        </div>
      )}

      {/* Role Reveal */}
      {gameState.phase === "role_reveal" && gameState.my_role && (
        <div className="rounded-xl border bg-card p-8 text-center mb-8">
          <Shield className="h-12 w-12 mx-auto text-primary mb-4" />
          <h2 className="text-xl font-bold mb-2">{t("game.yourRole")}</h2>
          <div className="inline-block rounded-full bg-primary/10 px-6 py-2 text-lg font-bold text-primary">
            {gameState.my_role === "civilian"
              ? t("games.undercover.roles.civilian")
              : gameState.my_role === "undercover"
                ? t("games.undercover.roles.undercover")
                : t("games.undercover.roles.mrWhite")}
          </div>
          {gameState.my_word && (
            <div className="mt-4">
              <p className="text-sm text-muted-foreground">{t("game.yourWord")}</p>
              <p className="text-2xl font-bold mt-1">{gameState.my_word}</p>
            </div>
          )}
          <button
            type="button"
            onClick={handleDismissRole}
            className="mt-6 rounded-md bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {t("game.undercover.iUnderstand")}
          </button>
        </div>
      )}

      {/* Describing Phase */}
      {gameState.phase === "describing" && (
        <div className="mb-8">
          {/* Role/Word reminder */}
          {gameState.my_role && gameState.my_role !== "mr_white" && gameState.my_word && (
            <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 mb-4 text-center">
              <span className="text-sm text-muted-foreground">{t("game.undercover.yourWordReminder")}:</span>{" "}
              <span className="font-bold text-primary">{gameState.my_word}</span>
            </div>
          )}

          <h2 className="text-xl font-bold text-center mb-4">{t("game.undercover.describeYourWord")}</h2>

          {/* Description Order */}
          {gameState.descriptionOrder.length > 0 && (
            <div className="rounded-lg border bg-card p-4 mb-4">
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <MessageCircle className="h-4 w-4" />
                {t("game.undercover.descriptionOrder")}
              </h3>
              <div className="space-y-1.5">
                {gameState.descriptionOrder.map((entry, idx) => {
                  const hasDescribed = !!gameState.descriptions[entry.user_id]
                  const isCurrent = idx === gameState.currentDescriberIndex && !hasDescribed
                  return (
                    <div
                      key={entry.user_id}
                      className={cn(
                        "flex items-center justify-between rounded-md px-3 py-1.5 text-sm",
                        isCurrent && "bg-primary/10 border border-primary/30",
                        hasDescribed && "opacity-60",
                      )}
                    >
                      <span className={cn("font-medium", isCurrent && "text-primary")}>
                        {idx + 1}. {entry.username}
                        {entry.user_id === user?.id && " (you)"}
                      </span>
                      {hasDescribed && (
                        <span className="text-xs bg-muted rounded-full px-2 py-0.5">
                          {gameState.descriptions[entry.user_id]}
                        </span>
                      )}
                      {isCurrent && !hasDescribed && (
                        <span className="text-xs text-primary font-semibold">
                          {entry.user_id === user?.id ? t("game.undercover.yourTurn") : "..."}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Description Input (my turn) */}
          {isMyTurnToDescribe && isAlive && (
            <div className="rounded-lg border bg-card p-4 mb-4">
              <label htmlFor="description-input" className="block text-sm font-medium mb-2">
                {t("game.undercover.describeYourWord")}
              </label>
              <div className="flex gap-2">
                <input
                  id="description-input"
                  type="text"
                  value={descriptionInput}
                  onChange={(e) => {
                    setDescriptionInput(e.target.value)
                    setDescriptionError("")
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSubmitDescription()
                  }}
                  placeholder={t("game.undercover.describeYourWord")}
                  maxLength={50}
                  disabled={isSubmittingDescription}
                  className="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={handleSubmitDescription}
                  disabled={isSubmittingDescription || !descriptionInput.trim()}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {isSubmittingDescription ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    t("game.undercover.submitDescription")
                  )}
                </button>
              </div>
              {descriptionError && (
                <p className="text-xs text-destructive mt-1">{descriptionError}</p>
              )}
            </div>
          )}

          {/* Waiting message (not my turn) */}
          {!isMyTurnToDescribe && currentDescriber && (
            <div className="rounded-lg bg-muted/50 p-3 mb-4 text-center">
              <p className="text-sm text-muted-foreground">
                {t("game.undercover.waitingForDescription", { username: currentDescriber.username })}
              </p>
            </div>
          )}

          {/* All descriptions done but transition not yet visible */}
          {gameState.currentDescriberIndex >= gameState.descriptionOrder.length && gameState.descriptionOrder.length > 0 && (
            <div className="rounded-lg bg-muted/50 p-3 mb-4 text-center">
              <Loader2 className="h-4 w-4 inline animate-spin mr-2" />
              <span className="text-sm text-muted-foreground">{t("common.loading")}</span>
            </div>
          )}
        </div>
      )}

      {/* Playing Phase (Voting) */}
      {gameState.phase === "playing" && (
        <div className="mb-8">
          {/* Role/Word reminder */}
          {gameState.my_role && gameState.my_role !== "mr_white" && gameState.my_word && (
            <div className="rounded-lg bg-primary/5 border border-primary/20 p-3 mb-4 text-center">
              <span className="text-sm text-muted-foreground">{t("game.undercover.yourWordReminder")}:</span>{" "}
              <span className="font-bold text-primary">{gameState.my_word}</span>
            </div>
          )}

          {/* Show descriptions from the describing phase */}
          {Object.keys(gameState.descriptions).length > 0 && (
            <div className="rounded-lg border bg-card p-4 mb-4">
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <MessageCircle className="h-4 w-4" />
                {t("game.undercover.descriptionOrder")}
              </h3>
              <div className="flex flex-wrap gap-2">
                {gameState.descriptionOrder.map((entry) => {
                  const word = gameState.descriptions[entry.user_id]
                  if (!word) return null
                  return (
                    <div key={entry.user_id} className="rounded-md bg-muted px-3 py-1.5 text-sm">
                      <span className="font-medium">{entry.username}:</span>{" "}
                      <span className="text-primary font-semibold">{word}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {!isAlive && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 mb-4 text-center">
              <Skull className="h-5 w-5 inline mr-2 text-destructive" />
              <span className="text-sm font-medium text-destructive">{t("game.undercover.youAreDead")}</span>
            </div>
          )}

          <h2 className="text-xl font-bold text-center mb-2">{t("game.undercover.discussAndVote")}</h2>
          <p className="text-sm text-muted-foreground text-center mb-4">{t("game.undercover.selectPlayerToVote")}</p>

          {hasVoted && (
            <div className="rounded-lg bg-muted/50 p-3 mb-4 text-center">
              <p className="text-sm text-muted-foreground">{t("game.undercover.waitingForVotes")}</p>
            </div>
          )}

          {isAlive && <div className="grid gap-3 sm:grid-cols-2">
            {gameState.players
              .filter((p) => p.is_alive && p.id !== user?.id)
              .map((player) => {
                const hasPlayerVoted = gameState.votedPlayers.includes(player.id)
                return (
                  <button
                    key={player.id}
                    type="button"
                    onClick={() => handleSelectPlayer(player.id)}
                    disabled={hasVoted || !isAlive}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border p-4 transition-colors",
                      selectedVote === player.id
                        ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                        : "hover:border-primary/50",
                      (hasVoted || !isAlive) && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                      <User className="h-5 w-5" />
                    </div>
                    <div className="text-left flex-1">
                      <div className="font-medium flex items-center gap-2">
                        {player.username}
                        {player.is_mayor && (
                          <Crown className="h-3.5 w-3.5 text-yellow-500" />
                        )}
                      </div>
                      {selectedVote === player.id && !hasVoted && (
                        <div className="flex items-center gap-1 text-xs text-primary">
                          <ThumbsUp className="h-3 w-3" />
                          Selected
                        </div>
                      )}
                      {hasVoted && selectedVote === player.id && (
                        <div className="flex items-center gap-1 text-xs text-primary">
                          <ThumbsUp className="h-3 w-3" />
                          {t("game.undercover.voted")}
                        </div>
                      )}
                    </div>
                    {hasPlayerVoted && (
                      <span className="text-xs bg-muted rounded-full px-2 py-0.5 text-muted-foreground">
                        {t("game.undercover.voted")}
                      </span>
                    )}
                  </button>
                )
              })}
          </div>}

          {/* Vote Confirmation Button */}
          {isAlive && !hasVoted && (
            <button
              type="button"
              onClick={handleConfirmVote}
              disabled={!selectedVote}
              className={cn(
                "mt-4 w-full rounded-md px-6 py-3 text-sm font-semibold transition-colors",
                selectedVote
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "bg-muted text-muted-foreground cursor-not-allowed",
              )}
            >
              {t("game.undercover.voteToEliminate")}
            </button>
          )}
        </div>
      )}

      {/* Elimination */}
      {gameState.phase === "elimination" && (
        <div className="rounded-xl border bg-card p-8 text-center mb-8">
          <Skull className="h-12 w-12 mx-auto text-destructive mb-4" />
          <h2 className="text-xl font-bold">{t("game.eliminated")}</h2>
          {gameState.eliminated_player_username && (
            <p className="text-lg mt-2">{gameState.eliminated_player_username}</p>
          )}
          {gameState.eliminated_player_role && (
            <p className="text-sm text-muted-foreground mt-1">
              {t("game.yourRole")}: {gameState.eliminated_player_role}
            </p>
          )}
          <button
            type="button"
            onClick={handleNextRound}
            className="mt-6 rounded-md bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {t("game.undercover.nextRound")}
          </button>
        </div>
      )}

      {/* Game Over */}
      {gameState.phase === "game_over" && (
        <div className="rounded-xl border bg-card p-8 text-center mb-8">
          <h2 className="text-3xl font-bold">{t("game.gameOver")}</h2>
          <p className="text-xl mt-4">
            {t("game.winner")}: {gameState.winner}
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            {roomIdRef.current && (
              <button
                type="button"
                onClick={() => navigate({ to: "/rooms/$roomId", params: { roomId: roomIdRef.current! } })}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                {t("game.backToRoom")}
              </button>
            )}
            <button
              type="button"
              onClick={handleLeaveRoom}
              className="inline-flex items-center gap-2 rounded-md border px-6 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted transition-colors"
            >
              <LogOut className="h-4 w-4" />
              {t("room.leave")}
            </button>
          </div>
        </div>
      )}

      {/* Player List */}
      <div className="rounded-xl border bg-card p-6">
        <h3 className="font-semibold mb-3">
          {t("room.players")} ({gameState.players.filter((p) => p.is_alive).length}/
          {gameState.players.length})
        </h3>
        <div className="space-y-2">
          {gameState.players.map((player) => (
            <div
              key={player.id}
              className={cn(
                "flex items-center justify-between rounded-lg px-4 py-2",
                player.is_alive ? "bg-muted/50" : "bg-destructive/5 line-through opacity-50",
              )}
            >
              <span className="text-sm flex items-center gap-2">
                {player.username}
                {player.is_mayor && <Crown className="h-3 w-3 text-yellow-500" />}
              </span>
              <span className="text-xs text-muted-foreground">
                {player.is_alive ? t("game.alive") : t("game.eliminated")}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Leave Game Button */}
      {gameState.phase !== "game_over" && gameState.phase !== "role_reveal" && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={handleLeaveRoom}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-destructive transition-colors"
          >
            <LogOut className="h-4 w-4" />
            {t("game.undercover.leaveGame")}
          </button>
        </div>
      )}
    </div>
  )
}
