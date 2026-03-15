import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Crown, Eye, Loader2, LogOut, MessageCircle, Trophy } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { getApiErrorMessage } from "@/api/client"
import {
  useGetUndercoverStateApiV1UndercoverGamesGameIdStateGet,
  getUndercoverStateApiV1UndercoverGamesGameIdStateGetQueryKey,
  useSubmitVoteApiV1UndercoverGamesGameIdVotePost,
  useSubmitDescriptionApiV1UndercoverGamesGameIdDescribePost,
  useRecordHintViewedApiV1UndercoverGamesGameIdHintViewedPost,
  useTimerExpiredApiV1UndercoverGamesGameIdTimerExpiredPost,
  useLeaveRoomApiV1RoomsLeavePatch,
  getRoomStateApiV1RoomsRoomIdStateGetQueryKey,
} from "@/api/generated"
import { useAchievementNotifications } from "@/components/achievements/AchievementToast"
import { GameErrorFallback } from "@/components/games/shared/GameErrorFallback"
import { PhaseTimer } from "@/components/games/shared/PhaseTimer"
import { DescriptionPhase } from "@/components/games/undercover/DescriptionPhase"
import { EliminationOverlay } from "@/components/games/undercover/EliminationOverlay"
import { VoteHistory } from "@/components/games/undercover/VoteHistory"
import { GameOverScreen } from "@/components/games/undercover/GameOverScreen"
import { RoleRevealPhase } from "@/components/games/undercover/RoleRevealPhase"
import { VotingPhase } from "@/components/games/undercover/VotingPhase"
import { useSocket } from "@/hooks/use-socket"
import { trackEvent } from "@/lib/analytics"
import { deriveUndercoverPhase, derivePlayerList, deriveVotedPlayers } from "@/lib/game-state"
import { useAuth } from "@/providers/AuthProvider"
import { cn } from "@/lib/utils"
import { retrieveRoomIdForGame } from "@/lib/room-session"

interface DescriptionOrderEntry {
  user_id: string
  username: string
}

interface VoteEntry {
  voter: string
  voter_id: string
  target: string
  target_id: string
}

interface EliminationData {
  username: string
  role: string
  votes: VoteEntry[]
}

interface GameState {
  players: { id: string; username: string; is_alive: boolean; is_mayor?: boolean }[]
  phase: "role_reveal" | "describing" | "playing" | "game_over"
  round: number
  my_role?: string
  my_word?: string
  winner?: string
  votedPlayers: string[]
  isHost: boolean
  descriptionOrder: DescriptionOrderEntry[]
  currentDescriberIndex: number
  descriptions: Record<string, string>
}

import { ErrorBoundary } from "@/components/ErrorBoundary"

export const Route = createFileRoute("/_auth/game/undercover/$gameId")({
  component: () => (
    <ErrorBoundary fallback={<GameErrorFallback />}>
      <UndercoverGamePage />
    </ErrorBoundary>
  ),
})

function UndercoverGamePage() {
  const { gameId } = Route.useParams()
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const roomIdRef = useRef<string | null>(null)
  const [socketRoomId, setSocketRoomId] = useState<string | null>(() => {
    const stored = retrieveRoomIdForGame(gameId)
    if (stored) roomIdRef.current = stored
    return stored
  })

  // Socket.IO for real-time updates — polling only kicks in when disconnected
  const { connected: socketConnected } = useSocket({ roomId: socketRoomId, gameId, gameType: "undercover", enabled: !!user })

  const [roleRevealed, setRoleRevealed] = useState(false)
  const [selectedVote, setSelectedVote] = useState<string | null>(null)
  const [descriptionInput, setDescriptionInput] = useState("")
  const [descriptionError, setDescriptionError] = useState("")
  const [isSubmittingDescription, setIsSubmittingDescription] = useState(false)
  const [showVotingTransition, setShowVotingTransition] = useState(false)
  const votingTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showGameOverTransition, setShowGameOverTransition] = useState(false)
  const gameOverTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previousWinnerRef = useRef<string | null>(null)
  const previousPhaseRef = useRef<string | null>(null)
  const previousRoundRef = useRef<number>(0)
  const [cancelMessage, setCancelMessage] = useState<string | null>(null)
  const [showEliminationOverlay, setShowEliminationOverlay] = useState(false)
  const [eliminationData, setEliminationData] = useState<EliminationData | null>(null)

  // Poll game state via REST only when Socket.IO is disconnected (safety net)
  const { data: serverState, isLoading, error: queryError } = useGetUndercoverStateApiV1UndercoverGamesGameIdStateGet(
    { game_id: gameId },
    { lang: i18n.language },
    {
      query: {
        refetchOnWindowFocus: true,
        refetchInterval: socketConnected ? false : 2_000,
        refetchIntervalInBackground: true,
        enabled: !!user,
      },
    },
  ) as {
    data: {
      my_role: string
      my_word: string
      my_word_hint: string | null
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
      vote_history?: {
        round: number
        votes: { voter: string; voter_id: string; target: string; target_id: string }[]
        eliminated: { username: string; role: string; user_id: string } | null
      }[]
      timer_config?: { description_seconds: number; voting_seconds: number }
      timer_started_at?: string | null
      newly_unlocked_achievements?: { user_id: string; achievements: { code: string; name: string; icon: string; tier: number }[] }[]
      word_explanations?: {
        civilian_word: string
        civilian_word_hint: string | null
        undercover_word: string
        undercover_word_hint: string | null
      }
    } | undefined
    isLoading: boolean
    error: Error | null
  }

  // Mutation hooks
  const voteMutation = useSubmitVoteApiV1UndercoverGamesGameIdVotePost()
  const describeMutation = useSubmitDescriptionApiV1UndercoverGamesGameIdDescribePost()
  const hintViewedMutation = useRecordHintViewedApiV1UndercoverGamesGameIdHintViewedPost()
  const timerExpiredMutation = useTimerExpiredApiV1UndercoverGamesGameIdTimerExpiredPost()
  const leaveMutation = useLeaveRoomApiV1RoomsLeavePatch()

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

    if (serverState.room_id) {
      roomIdRef.current = serverState.room_id
      if (!socketRoomId) setSocketRoomId(serverState.room_id)
    }

    const votedPlayerIds = deriveVotedPlayers(serverState.votes)

    const phase = deriveUndercoverPhase({
      winner: serverState.winner,
      turn_phase: serverState.turn_phase,
      turn_number: serverState.turn_number,
      my_role: serverState.my_role,
      roleRevealed,
    })

    return {
      players: derivePlayerList(serverState.players),
      phase,
      round: serverState.turn_number,
      my_role: serverState.my_role,
      my_word: serverState.my_word,
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

      // Show elimination overlay if a player was eliminated (not game over)
      if (!serverState.winner) {
        const latestVoteRound = serverState.vote_history?.find(
          (r) => r.round === previousRoundRef.current,
        )
        if (latestVoteRound?.eliminated) {
          setEliminationData({
            username: latestVoteRound.eliminated.username,
            role: latestVoteRound.eliminated.role,
            votes: latestVoteRound.votes,
          })
          setShowEliminationOverlay(true)
        }
      }
    }

    if (previousPhaseRef.current === "describing" && currentPhase === "voting" && !showVotingTransition) {
      setShowVotingTransition(true)
      votingTransitionTimerRef.current = setTimeout(() => {
        setShowVotingTransition(false)
        votingTransitionTimerRef.current = null
      }, 2500)
    }

    // Detect game over transition (winner goes null → value)
    const currentWinner = serverState.winner || null
    if (currentWinner && !previousWinnerRef.current && !showGameOverTransition) {
      trackEvent("game-over", { game: "undercover", winner: currentWinner })
      setShowGameOverTransition(true)
      gameOverTransitionTimerRef.current = setTimeout(() => {
        setShowGameOverTransition(false)
        gameOverTransitionTimerRef.current = null
      }, 3000)
    }
    previousWinnerRef.current = currentWinner

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
      await voteMutation.mutateAsync({ game_id: gameId, data: { voted_for: selectedVote } })
      queryClient.invalidateQueries({ queryKey: getUndercoverStateApiV1UndercoverGamesGameIdStateGetQueryKey({ game_id: gameId }) })
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to submit vote"))
    }
  }, [selectedVote, hasVoted, gameId, user, gameState.players, t, queryClient, voteMutation])

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
      await describeMutation.mutateAsync({ game_id: gameId, data: { word } })
      setDescriptionInput("")
      queryClient.invalidateQueries({ queryKey: getUndercoverStateApiV1UndercoverGamesGameIdStateGetQueryKey({ game_id: gameId }) })
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to submit description"))
    } finally {
      setIsSubmittingDescription(false)
    }
  }, [descriptionInput, user, gameId, isSubmittingDescription, t, queryClient, describeMutation])

  const handleDismissRole = useCallback(() => {
    setRoleRevealed(true)
  }, [])

  const handleHintViewed = useCallback(
    async (word: string) => {
      try {
        await hintViewedMutation.mutateAsync({ game_id: gameId, data: { word } })
      } catch {
        // Silent — hint tracking is best-effort
      }
    },
    [gameId, hintViewedMutation],
  )

  // Achievement notifications
  useAchievementNotifications(serverState?.newly_unlocked_achievements, user?.id)

  const timerExpiredRef = useRef(false)
  const handleTimerExpired = useCallback(async () => {
    if (!gameState.isHost || timerExpiredRef.current) return
    timerExpiredRef.current = true
    try {
      await timerExpiredMutation.mutateAsync({ game_id: gameId })
      queryClient.invalidateQueries({ queryKey: getUndercoverStateApiV1UndercoverGamesGameIdStateGetQueryKey({ game_id: gameId }) })
    } catch {
      // Ignore — another client may have already triggered it
    } finally {
      timerExpiredRef.current = false
    }
  }, [gameId, gameState.isHost, queryClient, timerExpiredMutation])

  const handleLeaveRoom = useCallback(async () => {
    if (!user || !roomIdRef.current) {
      navigate({ to: "/rooms" })
      return
    }
    try {
      await leaveMutation.mutateAsync({ data: { user_id: user.id, room_id: roomIdRef.current } })
    } catch {
      // Ignore errors — navigate anyway
    }
    toast.info(t("toast.youLeftRoom"))
    navigate({ to: "/rooms" })
  }, [user, navigate, t, leaveMutation])

  const handleBackToRoom = useCallback(() => {
    if (roomIdRef.current) {
      queryClient.removeQueries({ queryKey: getRoomStateApiV1RoomsRoomIdStateGetQueryKey({ room_id: roomIdRef.current }) })
      navigate({ to: "/rooms/$roomId", params: { roomId: roomIdRef.current } })
    }
  }, [navigate, queryClient])

  const handleDismissElimination = useCallback(() => {
    setShowEliminationOverlay(false)
  }, [])

  const handleDescriptionInputChange = useCallback((value: string) => {
    setDescriptionInput(value)
    setDescriptionError("")
  }, [])

  const myPlayer = gameState.players.find((p) => p.id === user?.id)
  const isAlive = myPlayer?.is_alive !== false
  const isSpectator = gameState.my_role === "spectator"

  const isMyTurnToDescribe =
    gameState.phase === "describing" &&
    gameState.descriptionOrder.length > 0 &&
    gameState.currentDescriberIndex < gameState.descriptionOrder.length &&
    gameState.descriptionOrder[gameState.currentDescriberIndex]?.user_id === user?.id

  if (cancelMessage) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="glass rounded-2xl border-border/30 p-8 text-center bg-destructive/10">
          <h2 className="text-xl font-extrabold tracking-tight text-destructive mb-2">{t("game.gameOver")}</h2>
          <p className="text-muted-foreground">{cancelMessage}</p>
          <p className="text-sm text-muted-foreground mt-2">Redirecting...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 min-h-screen">
      {/* Game Over Transition Overlay */}
      <AnimatePresence>
        {showGameOverTransition && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-md"
          >
            <motion.div className="glass rounded-2xl border-border/30 p-10 text-center space-y-4">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", delay: 0.2 }}
              >
                <Trophy className="h-16 w-16 mx-auto text-yellow-500 drop-shadow-lg" />
              </motion.div>
              <motion.h2
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="text-2xl font-extrabold tracking-tight gradient-text"
              >
                {t("game.gameOver")}
              </motion.h2>
              <motion.p
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.7 }}
                className="text-lg text-muted-foreground"
              >
                {t("game.gameOverTransition")}
              </motion.p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Voting Transition Overlay */}
      <AnimatePresence>
        {showVotingTransition && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-md"
          >
            <motion.div className="glass rounded-2xl border-border/30 p-10 text-center space-y-4">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", delay: 0.2 }}
              >
                <MessageCircle className="h-16 w-16 mx-auto text-primary drop-shadow-lg" />
              </motion.div>
              <motion.h2
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="text-2xl font-extrabold tracking-tight gradient-text"
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
        <h1 className="text-3xl font-extrabold tracking-tight gradient-text">{t("games.undercover.name")}</h1>
        <p className="text-sm text-muted-foreground mt-2 font-mono tabular-nums">Round {gameState.round}</p>
        {isSpectator && (
          <div className="mt-3 glass inline-flex items-center gap-1.5 rounded-full border-border/30 px-4 py-1.5 text-xs font-medium text-muted-foreground transition-all duration-200">
            <Eye className="h-3 w-3" />
            {t("game.spectating")}
          </div>
        )}
      </div>

      {/* Loading State */}
      {isLoading && !gameState.my_role && (
        <div className="glass rounded-2xl border-border/30 p-8 text-center mb-8 transition-all duration-200">
          <Loader2 className="h-10 w-10 mx-auto animate-spin text-primary mb-4" />
          <p className="text-muted-foreground">{t("common.loading")}</p>
        </div>
      )}

      {/* Role Reveal (not for spectators) */}
      {gameState.phase === "role_reveal" && gameState.my_role && !isSpectator && (
        <RoleRevealPhase
          myRole={gameState.my_role}
          myWord={gameState.my_word}
          myWordHint={serverState?.my_word_hint ?? null}
          onHintViewed={handleHintViewed}
          onDismiss={handleDismissRole}
        />
      )}

      {/* Phase Timer */}
      {serverState?.timer_config && serverState?.timer_started_at && (gameState.phase === "describing" || gameState.phase === "playing") &&
        (gameState.phase === "describing" ? serverState.timer_config.description_seconds : serverState.timer_config.voting_seconds) > 0 && (
        <div className="mb-4">
          <PhaseTimer
            timerStartedAt={serverState.timer_started_at}
            durationSeconds={
              gameState.phase === "describing"
                ? serverState.timer_config.description_seconds
                : serverState.timer_config.voting_seconds
            }
            onExpired={handleTimerExpired}
          />
        </div>
      )}

      {/* Describing Phase */}
      {gameState.phase === "describing" && (
        <DescriptionPhase
          myRole={gameState.my_role}
          myWord={gameState.my_word}
          myWordHint={serverState?.my_word_hint ?? null}
          onHintViewed={handleHintViewed}
          descriptionOrder={gameState.descriptionOrder}
          currentDescriberIndex={gameState.currentDescriberIndex}
          descriptions={gameState.descriptions}
          currentUserId={user?.id}
          isMyTurnToDescribe={isMyTurnToDescribe}
          isAlive={isAlive}
          descriptionInput={descriptionInput}
          descriptionError={descriptionError}
          isSubmittingDescription={isSubmittingDescription}
          onDescriptionInputChange={handleDescriptionInputChange}
          onSubmitDescription={handleSubmitDescription}
        />
      )}

      {/* Playing Phase (Voting) */}
      {gameState.phase === "playing" && (
        <VotingPhase
          players={gameState.players}
          myRole={gameState.my_role}
          myWord={gameState.my_word}
          myWordHint={serverState?.my_word_hint ?? null}
          onHintViewed={handleHintViewed}
          descriptions={gameState.descriptions}
          descriptionOrder={gameState.descriptionOrder}
          isAlive={isAlive}
          hasVoted={hasVoted}
          selectedVote={selectedVote}
          votedPlayers={gameState.votedPlayers}
          currentUserId={user?.id}
          onSelectPlayer={handleSelectPlayer}
          onConfirmVote={handleConfirmVote}
        />
      )}

      {/* Elimination Overlay (full-screen with vote breakdown) */}
      {showEliminationOverlay && eliminationData && (
        <EliminationOverlay
          eliminatedUsername={eliminationData.username}
          eliminatedRole={eliminationData.role}
          votes={eliminationData.votes}
          onDismiss={handleDismissElimination}
        />
      )}

      {/* Game Over */}
      {gameState.phase === "game_over" && !showGameOverTransition && (
        <GameOverScreen
          winner={gameState.winner}
          roomId={roomIdRef.current}
          wordExplanations={serverState?.word_explanations}
          onBackToRoom={handleBackToRoom}
          onLeaveRoom={handleLeaveRoom}
        />
      )}

      {/* Vote History */}
      {serverState?.vote_history && serverState.vote_history.length > 0 && (
        <VoteHistory history={serverState.vote_history} />
      )}

      {/* Player List */}
      <div className="glass rounded-2xl border-border/30 p-6 transition-all duration-200">
        <h3 className="font-extrabold tracking-tight mb-4">
          {t("room.players")} ({gameState.players.filter((p) => p.is_alive).length}/
          {gameState.players.length})
        </h3>
        <div className="space-y-2">
          {gameState.players.map((player) => (
            <div
              key={player.id}
              className={cn(
                "flex items-center justify-between rounded-2xl px-4 py-2.5 border transition-all duration-200",
                player.is_alive
                  ? "glass border-border/30 hover:border-border/50"
                  : "bg-destructive/5 border-destructive/10 line-through opacity-50",
              )}
            >
              <span className="text-sm flex items-center gap-2 font-medium">
                {player.username}
                {player.is_mayor && <Crown className="h-3 w-3 text-yellow-500 drop-shadow-sm" />}
              </span>
              <span className="text-xs text-muted-foreground font-mono tabular-nums">
                {player.is_alive ? t("game.alive") : t("game.eliminated")}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Leave Game Button */}
      {gameState.phase !== "game_over" && gameState.phase !== "role_reveal" && (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={handleLeaveRoom}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-destructive transition-all duration-200 rounded-2xl px-4 py-2 hover:bg-destructive/5"
          >
            <LogOut className="h-4 w-4" />
            {t("game.undercover.leaveGame")}
          </button>
        </div>
      )}
    </div>
  )
}
