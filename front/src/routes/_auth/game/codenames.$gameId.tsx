import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Eye, Trophy, Users } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { getApiErrorMessage } from "@/api/client"
import {
  useGetCodenamesBoardApiV1CodenamesGamesGameIdBoardGet,
  getCodenamesBoardApiV1CodenamesGamesGameIdBoardGetQueryKey,
  useGiveClueApiV1CodenamesGamesGameIdCluePost,
  useGuessCardApiV1CodenamesGamesGameIdGuessPost,
  useEndTurnApiV1CodenamesGamesGameIdEndTurnPost,
  useRecordHintViewedApiV1CodenamesGamesGameIdHintViewedPost,
  useTimerExpiredApiV1CodenamesGamesGameIdTimerExpiredPost,
  useLeaveRoomApiV1RoomsLeavePatch,
  getRoomStateApiV1RoomsRoomIdStateGetQueryKey,
} from "@/api/generated"
import { useAchievementNotifications } from "@/components/achievements/AchievementToast"
import { GameErrorFallback } from "@/components/games/shared/GameErrorFallback"
import { PhaseTimer } from "@/components/games/shared/PhaseTimer"
import { ClueHistory } from "@/components/games/codenames/ClueHistory"
import { CluePanel } from "@/components/games/codenames/CluePanel"
import { GameBoard } from "@/components/games/codenames/GameBoard"
import { GameOverScreen } from "@/components/games/codenames/GameOverScreen"
import { ScorePanel } from "@/components/games/codenames/ScorePanel"
import { useSocket } from "@/hooks/use-socket"
import { trackEvent } from "@/lib/analytics"
import { useAuth } from "@/providers/AuthProvider"
import { cn } from "@/lib/utils"
import { retrieveRoomIdForGame } from "@/lib/room-session"

interface CodenamesCard {
  word: string
  card_type: "red" | "blue" | "neutral" | "assassin" | null
  revealed: boolean
  hint?: string | null
}

interface CodenamesTurn {
  team: "red" | "blue"
  clue_word: string | null
  clue_number: number
  guesses_made: number
  max_guesses: number | null
  card_votes?: Record<string, number>
}

interface CodenamesPlayer {
  user_id: string
  username: string
  team: string
  role: string
}

interface CodenamesGameState {
  board: CodenamesCard[]
  current_team: "red" | "blue"
  current_turn: CodenamesTurn | null
  my_team: "red" | "blue" | "spectator"
  my_role: "spymaster" | "operative" | "spectator"
  red_remaining: number
  blue_remaining: number
  status: "waiting" | "in_progress" | "finished"
  winner: "red" | "blue" | null
  players: CodenamesPlayer[]
  room_id?: string
}

import { ErrorBoundary } from "@/components/ErrorBoundary"

export const Route = createFileRoute("/_auth/game/codenames/$gameId")({
  component: () => (
    <ErrorBoundary fallback={<GameErrorFallback />}>
      <CodenamesGamePage />
    </ErrorBoundary>
  ),
})

function CodenamesGamePage() {
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
  const { connected: socketConnected } = useSocket({ roomId: socketRoomId, gameId, gameType: "codenames", enabled: !!user })

  const [clueWord, setClueWord] = useState("")
  const [clueNumber, setClueNumber] = useState(1)
  const [isSubmittingClue, setIsSubmittingClue] = useState(false)
  const [cancelMessage, setCancelMessage] = useState<string | null>(null)
  const [showGameOverTransition, setShowGameOverTransition] = useState(false)
  const gameOverTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previousStatusRef = useRef<string | null>(null)

  // Poll game state via REST only when Socket.IO is disconnected (safety net)
  const { data: serverState, isLoading, error: queryError } = useGetCodenamesBoardApiV1CodenamesGamesGameIdBoardGet(
    { game_id: gameId },
    { lang: i18n.language },
    {
      query: {
        refetchOnWindowFocus: true,
        refetchInterval: socketConnected ? 3_000 : 2_000,
        refetchIntervalInBackground: true,
        enabled: !!user,
      },
    },
  ) as {
    data: {
      game_id: string
      room_id?: string
      team: "red" | "blue" | "spectator"
      role: "spymaster" | "operative" | "spectator"
      is_host?: boolean
      board: CodenamesCard[]
      current_team: "red" | "blue"
      red_remaining: number
      blue_remaining: number
      status: string
      current_turn: CodenamesTurn | null
      winner: "red" | "blue" | null
      players?: CodenamesPlayer[]
      clue_history?: {
        team: "red" | "blue"
        clue_word: string
        clue_number: number
        guesses: { word: string; card_type: string; correct: boolean }[]
      }[]
      timer_config?: { clue_seconds: number; guess_seconds: number }
      timer_started_at?: string | null
      newly_unlocked_achievements?: { user_id: string; achievements: { code: string; name: string; icon: string; tier: number }[] }[]
    } | undefined
    isLoading: boolean
    error: Error | null
  }

  // Mutation hooks
  const clueMutation = useGiveClueApiV1CodenamesGamesGameIdCluePost()
  const guessMutation = useGuessCardApiV1CodenamesGamesGameIdGuessPost()
  const endTurnMutation = useEndTurnApiV1CodenamesGamesGameIdEndTurnPost()
  const hintViewedMutation = useRecordHintViewedApiV1CodenamesGamesGameIdHintViewedPost()
  const timerExpiredMutation = useTimerExpiredApiV1CodenamesGamesGameIdTimerExpiredPost()
  const leaveMutation = useLeaveRoomApiV1RoomsLeavePatch()

  // Derive game state from server data
  const gameState = useMemo<CodenamesGameState | null>(() => {
    if (!serverState) return null
    if (serverState.room_id) {
      roomIdRef.current = serverState.room_id
      if (!socketRoomId) setSocketRoomId(serverState.room_id)
    }
    return {
      board: serverState.board,
      current_team: serverState.current_team,
      current_turn: serverState.current_turn,
      my_team: serverState.team,
      my_role: serverState.role,
      red_remaining: serverState.red_remaining,
      blue_remaining: serverState.blue_remaining,
      status: serverState.status as "waiting" | "in_progress" | "finished",
      winner: serverState.winner,
      players: serverState.players || [],
      room_id: serverState.room_id,
    }
  }, [serverState])

  // Detect game over transition (status goes to "finished")
  useEffect(() => {
    if (!serverState) return
    const currentStatus = serverState.status
    if (currentStatus === "finished" && previousStatusRef.current && previousStatusRef.current !== "finished" && !showGameOverTransition) {
      trackEvent("game-over", { game: "codenames", winner: serverState.winner || "" })
      setShowGameOverTransition(true)
      gameOverTransitionTimerRef.current = setTimeout(() => {
        setShowGameOverTransition(false)
        gameOverTransitionTimerRef.current = null
      }, 3000)
    }
    previousStatusRef.current = currentStatus
  }, [serverState])

  // Handle query error (game not found / cancelled)
  useEffect(() => {
    if (queryError) {
      const errMsg = getApiErrorMessage(queryError, "Game not found")
      if (errMsg.includes("not found") || errMsg.includes("cancelled") || errMsg.includes("removed")) {
        setCancelMessage(errMsg)
        setTimeout(() => navigate({ to: "/" }), 3000)
      }
    }
  }, [queryError, navigate])

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

  const handleGiveClue = useCallback(async () => {
    if (!clueWord.trim() || isSubmittingClue) return
    setIsSubmittingClue(true)
    try {
      await clueMutation.mutateAsync({ game_id: gameId, data: { clue_word: clueWord.trim(), clue_number: clueNumber } })
      setClueWord("")
      setClueNumber(1)
      queryClient.invalidateQueries({ queryKey: getCodenamesBoardApiV1CodenamesGamesGameIdBoardGetQueryKey({ game_id: gameId }) })
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to give clue"))
    } finally {
      setIsSubmittingClue(false)
    }
  }, [gameId, clueWord, clueNumber, isSubmittingClue, queryClient, clueMutation])

  const handleGuessCard = useCallback(
    async (index: number) => {
      try {
        const data = await guessMutation.mutateAsync({ game_id: gameId, data: { card_index: index } }) as { all_voted?: boolean; vote_changed?: boolean; tied?: boolean }
        if (data.all_voted === false) {
          toast.info(data.vote_changed ? t("game.codenames.voteChanged") : t("game.codenames.voteSubmitted"))
        } else if (data.tied) {
          toast.warning(t("game.codenames.tieWarning"))
        }
        queryClient.invalidateQueries({ queryKey: getCodenamesBoardApiV1CodenamesGamesGameIdBoardGetQueryKey({ game_id: gameId }) })
      } catch (err) {
        toast.error(getApiErrorMessage(err, "Failed to guess card"))
      }
    },
    [gameId, queryClient, t, guessMutation],
  )

  const handleEndTurn = useCallback(async () => {
    try {
      await endTurnMutation.mutateAsync({ game_id: gameId })
      queryClient.invalidateQueries({ queryKey: getCodenamesBoardApiV1CodenamesGamesGameIdBoardGetQueryKey({ game_id: gameId }) })
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Failed to end turn"))
    }
  }, [gameId, queryClient, endTurnMutation])

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

  // Achievement notifications
  useAchievementNotifications(serverState?.newly_unlocked_achievements, user?.id)

  const timerExpiredRef = useRef(false)
  const handleTimerExpired = useCallback(async () => {
    if (!serverState?.is_host || timerExpiredRef.current) return
    timerExpiredRef.current = true
    try {
      await timerExpiredMutation.mutateAsync({ game_id: gameId })
      queryClient.invalidateQueries({ queryKey: getCodenamesBoardApiV1CodenamesGamesGameIdBoardGetQueryKey({ game_id: gameId }) })
    } catch {
      // Ignore — another client may have already triggered it
    } finally {
      timerExpiredRef.current = false
    }
  }, [gameId, queryClient, serverState?.is_host, timerExpiredMutation])

  if (cancelMessage) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="glass rounded-2xl border-border/30 p-8 text-center bg-destructive/10">
          <h2 className="text-xl font-extrabold tracking-tight text-destructive mb-2">{t("game.gameOver")}</h2>
          <p className="text-muted-foreground">{cancelMessage}</p>
          <p className="text-sm text-muted-foreground mt-2">Redirecting...</p>
        </div>
      </div>
    )
  }

  if (!gameState) {
    if (isLoading) {
      return (
        <div className="flex min-h-[60vh] items-center justify-center">
          <p className="text-muted-foreground">{t("common.loading")}</p>
        </div>
      )
    }
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="glass rounded-2xl border-border/30 p-8 text-center bg-destructive/10">
          <h2 className="text-xl font-extrabold tracking-tight text-destructive mb-2">{t("common.error")}</h2>
          <p className="text-muted-foreground">Failed to load game state. The game may no longer exist.</p>
          <button
            type="button"
            onClick={() => navigate({ to: "/" })}
            className="mt-4 rounded-2xl bg-gradient-to-r from-primary to-primary/90 px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-all duration-200"
          >
            {t("common.goHome")}
          </button>
        </div>
      </div>
    )
  }

  const isSpectator = gameState.my_role === "spectator"
  const isMyTurn = !isSpectator && gameState.current_team === gameState.my_team
  const isSpymaster = gameState.my_role === "spymaster"
  const canGiveClue = isMyTurn && isSpymaster && !gameState.current_turn?.clue_word
  const canGuess = isMyTurn && !isSpymaster && !!gameState.current_turn?.clue_word

  const redPlayers = gameState.players.filter((p) => p.team === "red")
  const bluePlayers = gameState.players.filter((p) => p.team === "blue")

  // Vote state
  const cardVotes = gameState.current_turn?.card_votes ?? {}
  const votedCount = Object.keys(cardVotes).length
  const totalOperatives = gameState.players.filter(
    (p) => p.team === gameState.current_team && p.role === "operative",
  ).length
  const isVotingActive = !!gameState.current_turn?.clue_word && totalOperatives > 1 && votedCount > 0 && gameState.status === "in_progress"

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 min-h-screen">
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

      {/* Header + Score + Turn Info */}
      <ScorePanel
        redRemaining={gameState.red_remaining}
        blueRemaining={gameState.blue_remaining}
        currentTeam={gameState.current_team}
        currentTurn={gameState.current_turn}
        isMyTurn={isMyTurn}
        isFinished={gameState.status === "finished"}
      />

      {/* Spectator Badge */}
      {isSpectator && (
        <div className="mb-4 flex justify-center">
          <div className="glass inline-flex items-center gap-1.5 rounded-full border-border/30 px-4 py-1.5 text-xs font-medium text-muted-foreground transition-all duration-200">
            <Eye className="h-3 w-3" />
            {t("game.spectating")}
          </div>
        </div>
      )}

      {/* Phase Timer */}
      {serverState?.timer_config && serverState?.timer_started_at && gameState.status === "in_progress" &&
        (gameState.current_turn?.clue_word ? serverState.timer_config.guess_seconds : serverState.timer_config.clue_seconds) > 0 && (
        <div className="mb-4">
          <PhaseTimer
            timerStartedAt={serverState.timer_started_at}
            durationSeconds={
              gameState.current_turn?.clue_word
                ? serverState.timer_config.guess_seconds
                : serverState.timer_config.clue_seconds
            }
            onExpired={handleTimerExpired}
          />
        </div>
      )}

      {/* Vote Progress */}
      {isVotingActive && (
        <div className="mb-4 glass rounded-2xl border-border/30 p-3 text-center text-sm text-muted-foreground transition-all duration-200">
          {t("game.codenames.votesProgress", { current: votedCount, total: totalOperatives })}
        </div>
      )}

      {/* Board */}
      <GameBoard
        board={gameState.board}
        isSpymaster={isSpymaster}
        canGuess={canGuess}
        isFinished={gameState.status === "finished"}
        onGuessCard={handleGuessCard}
        cardVotes={cardVotes}
        currentUserId={user?.id}
        onHintViewed={handleHintViewed}
      />

      {/* Spymaster Clue Input */}
      {canGiveClue && (
        <CluePanel
          clueWord={clueWord}
          clueNumber={clueNumber}
          isSubmitting={isSubmittingClue}
          onClueWordChange={setClueWord}
          onClueNumberChange={setClueNumber}
          onSubmit={handleGiveClue}
        />
      )}

      {/* End Turn Button */}
      {canGuess && (
        <button
          type="button"
          onClick={handleEndTurn}
          className="w-full rounded-2xl border border-border/30 bg-gradient-to-r from-primary/10 to-primary/5 px-4 py-2.5 text-sm font-medium text-primary hover:from-primary/20 hover:to-primary/10 transition-all duration-200"
        >
          {t("game.codenames.endTurn")}
        </button>
      )}

      {/* Game Over */}
      {gameState.status === "finished" && gameState.winner && !showGameOverTransition && (
        <GameOverScreen
          winner={gameState.winner}
          roomId={roomIdRef.current}
          board={gameState.board}
          onBackToRoom={handleBackToRoom}
          onLeaveRoom={handleLeaveRoom}
        />
      )}

      {/* Player List */}
      {gameState.players.length > 0 && (
        <div className="mt-6 glass rounded-2xl border-border/30 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-extrabold tracking-tight text-sm">{t("game.codenames.players")}</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {/* Red Team */}
            <div className="relative">
              <div className="absolute inset-y-0 left-0 w-1 rounded-full bg-red-500/70" />
              <div className="pl-4">
                <h4 className="text-xs font-extrabold tracking-tight text-red-600 dark:text-red-400 mb-2">
                  {t("games.codenames.teams.red")}
                </h4>
                <div className="space-y-1.5">
                  {redPlayers.map((p) => (
                    <div key={p.user_id} className="flex items-center justify-between rounded-2xl px-3 py-1.5 bg-red-50/80 dark:bg-red-950/30 border border-red-200/30 dark:border-red-800/20 text-sm transition-all duration-200 hover:bg-red-100/80 dark:hover:bg-red-950/50">
                      <span className="font-medium">{p.username}</span>
                      <span className="text-xs text-muted-foreground font-mono tabular-nums">
                        {p.role === "spymaster" ? t("games.codenames.roles.spymaster") : t("games.codenames.roles.operative")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* Blue Team */}
            <div className="relative">
              <div className="absolute inset-y-0 left-0 w-1 rounded-full bg-blue-500/70" />
              <div className="pl-4">
                <h4 className="text-xs font-extrabold tracking-tight text-blue-600 dark:text-blue-400 mb-2">
                  {t("games.codenames.teams.blue")}
                </h4>
                <div className="space-y-1.5">
                  {bluePlayers.map((p) => (
                    <div key={p.user_id} className="flex items-center justify-between rounded-2xl px-3 py-1.5 bg-blue-50/80 dark:bg-blue-950/30 border border-blue-200/30 dark:border-blue-800/20 text-sm transition-all duration-200 hover:bg-blue-100/80 dark:hover:bg-blue-950/50">
                      <span className="font-medium">{p.username}</span>
                      <span className="text-xs text-muted-foreground font-mono tabular-nums">
                        {p.role === "spymaster" ? t("games.codenames.roles.spymaster") : t("games.codenames.roles.operative")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Clue History */}
      {serverState?.clue_history && serverState.clue_history.length > 0 && (
        <ClueHistory history={serverState.clue_history} />
      )}

      {/* My Info */}
      {!isSpectator && (
        <div className="mt-6 glass rounded-2xl border-border/30 p-4 text-center text-sm text-muted-foreground transition-all duration-200">
          {t("game.codenames.youAre")}{" "}
          <span
            className={cn(
              "font-extrabold tracking-tight",
              gameState.my_team === "red" ? "text-red-600 dark:text-red-400" : "text-blue-600 dark:text-blue-400",
            )}
          >
            {gameState.my_team === "red"
              ? t("games.codenames.teams.red")
              : t("games.codenames.teams.blue")}
          </span>{" "}
          <span className="font-extrabold tracking-tight">
            {gameState.my_role === "spymaster"
              ? t("games.codenames.roles.spymaster")
              : t("games.codenames.roles.operative")}
          </span>
        </div>
      )}
    </div>
  )
}
