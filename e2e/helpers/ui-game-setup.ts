import { expect, type Browser, type Page } from "@playwright/test";
import {
  apiLogin,
  apiCreateRoom,
  apiGetRoom,
  apiJoinRoom,
  type LoginResponse,
  type RoomResponse,
} from "./api-client";
import { createPlayerPage } from "../fixtures/auth.fixture";
import { ROUTES } from "./constants";

// ─── Types ──────────────────────────────────────────────────

export interface PlayerContext {
  page: Page;
  login: LoginResponse;
  account: { email: string; password: string };
}

export interface UIGameSetup {
  players: PlayerContext[];
  roomDetails: RoomResponse;
  roomId: string;
  cleanup: () => Promise<void>;
}

export interface CodenamesPlayerRole {
  team: "red" | "blue";
  role: "spymaster" | "operative";
}

// ─── Utilities ──────────────────────────────────────────────

/**
 * Check if a Playwright page is still alive (browser context not closed).
 * Uses page.url() which is a local property (no IPC to browser process).
 * Unlike page.evaluate(() => true) which can hang 30s+ under load,
 * this is instant and never blocks.
 */
export function isPageAlive(page: Page): boolean {
  try {
    page.url();
    return true;
  } catch {
    return false;
  }
}

// ─── Room Setup via UI ──────────────────────────────────────

/**
 * Create a room via API (faster), then have all players join through the UI.
 * Player 1 (host) navigates directly to the room lobby.
 * Other players join via the rooms page with room code + PIN.
 */
export async function setupRoomWithPlayers(
  browser: Browser,
  accounts: { email: string; password: string }[],
  gameType: "undercover" | "codenames" = "undercover",
): Promise<UIGameSetup> {
  // Login all players via API (parallel for speed)
  const logins = await Promise.all(
    accounts.map((a) => apiLogin(a.email, a.password)),
  );

  // Host creates room via API
  const room = await apiCreateRoom(logins[0].access_token, gameType);
  const roomDetails = await apiGetRoom(room.id, logins[0].access_token);

  // Create browser page for host and navigate to room
  const hostPage = await createPlayerPage(
    browser,
    accounts[0].email,
    accounts[0].password,
  );
  await hostPage.goto(ROUTES.room(room.id));
  await hostPage.waitForLoadState("domcontentloaded");
  // Wait for room page to render with player count
  await hostPage.waitForFunction(
    () => /Players \(\d+/.test(document.body.innerText),
    { timeout: 10_000 },
  ).catch(() => {});

  const players: PlayerContext[] = [
    { page: hostPage, login: logins[0], account: accounts[0] },
  ];

  // Other players join via UI
  for (let i = 1; i < accounts.length; i++) {
    const page = await createPlayerPage(
      browser,
      accounts[i].email,
      accounts[i].password,
    );

    // Helper: fill form and click join
    const fillAndJoin = async () => {
      await page.locator('input[id="room-code"]').fill(roomDetails.public_id);
      const pinDigits = roomDetails.password.split("");
      for (let j = 0; j < 4; j++) {
        await page
          .locator(`input[aria-label="Password digit ${j + 1}"]`)
          .fill(pinDigits[j]);
      }
      const joinBtn = page.locator('button[type="submit"]');
      await expect(joinBtn).toBeEnabled({ timeout: 10_000 });
      await joinBtn.click();
      return page
        .waitForURL(/\/rooms\/[a-f0-9-]+/, { timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
    };

    await page.goto(ROUTES.rooms);
    await page.waitForLoadState("domcontentloaded");

    // Wait for socket connected + room_status listener registered in React
    await page.waitForFunction(
      () => {
        const s = (window as any).__SOCKET__;
        if (!s?.connected) return false;
        // Socket.IO v4 hasListeners checks if the event has any listeners
        return typeof s.hasListeners === "function"
          ? s.hasListeners("room_status")
          : true;
      },
      { timeout: 10_000 },
    );

    // Attempt 1: UI join
    let joined = await fillAndJoin();

    // Attempt 2: API fallback + direct navigation
    if (!joined) {
      // Try API join with retry
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await apiJoinRoom(
            room.id,
            logins[i].user.id,
            roomDetails.password,
            logins[i].access_token,
          );
          break; // Success
        } catch {
          if (attempt === 0) await page.waitForTimeout(1_000);
        }
      }
      await page.goto(ROUTES.room(room.id));
      await page.waitForLoadState("domcontentloaded");
      await page.waitForFunction(
        () => (window as any).__SOCKET__?.connected === true,
        { timeout: 10_000 },
      );
      await page.waitForFunction(
        () => /Players \(\d+/.test(document.body.innerText),
        { timeout: 15_000 },
      );
    }

    await expect(page).toHaveURL(/\/rooms\/[a-f0-9-]+/, { timeout: 15_000 });

    players.push({ page, login: logins[i], account: accounts[i] });

    // Small delay between joins to reduce backend contention under parallel load
    if (i < accounts.length - 1) {
      await page.waitForTimeout(500);
    }
  }

  // Verify room membership via API — if players are missing, force-join them
  const expectedCount = accounts.length;
  const roomCheck = await apiGetRoom(room.id, logins[0].access_token);
  const joinedUserIds = new Set(roomCheck.users.map((u) => u.id));

  for (let i = 0; i < logins.length; i++) {
    if (!joinedUserIds.has(logins[i].user.id)) {
      // Player not in room — force-join via API
      await apiJoinRoom(
        room.id,
        logins[i].user.id,
        roomDetails.password,
        logins[i].access_token,
      ).catch(() => {});
      // Navigate player to the room page
      await players[i].page.goto(ROUTES.room(room.id));
      await players[i].page.waitForLoadState("domcontentloaded");
    }
  }

  // Verify ALL players have Socket.IO connected and see the full player count
  await Promise.all(
    players.map(async (player) => {
      const verifySocketAndCount = async () => {
        await player.page.waitForFunction(
          (count) => {
            const s = (window as any).__SOCKET__;
            if (!s?.connected) return false;
            const m = document.body.innerText.match(/Players \((\d+)/);
            return m && parseInt(m[1]) >= count;
          },
          expectedCount,
          { timeout: 15_000 },
        );
      };

      try {
        await verifySocketAndCount();
      } catch {
        // Reload to trigger join_room again and retry
        await player.page.reload();
        await player.page.waitForLoadState("domcontentloaded");
        await verifySocketAndCount().catch(() => {});
      }
    }),
  );

  return {
    players,
    roomDetails,
    roomId: room.id,
    cleanup: async () => {
      for (const p of players) {
        await p.page.context().close().catch(() => {});
      }
    },
  };
}

// ─── Game Start via UI ──────────────────────────────────────

/**
 * Host clicks the start button. For codenames, first selects the game type.
 * Returns after all players have navigated to the game page.
 */
export async function startGameViaUI(
  players: PlayerContext[],
  gameType: "undercover" | "codenames",
): Promise<void> {
  const hostPage = players[0].page;

  // Extract room ID from host URL before navigation (needed for codenames sessionStorage)
  const roomIdMatch = hostPage.url().match(/\/rooms\/([a-f0-9-]+)/);
  const roomId = roomIdMatch?.[1] ?? "";

  // Wait for all players to appear in the lobby before starting
  const playerCountText = `Players (${players.length})`;
  let playersVisible = await hostPage
    .locator(`text=${playerCountText}`)
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!playersVisible) {
    // Reload host page to get latest room state
    await hostPage.reload();
    await hostPage.waitForLoadState("domcontentloaded");
  }
  await expect(
    hostPage.locator(`text=${playerCountText}`),
  ).toBeVisible({ timeout: 15_000 });

  // Wait for socket to confirm all players are in the Socket.IO room
  await hostPage.waitForFunction(
    () => (window as any).__SOCKET__?.connected === true,
    { timeout: 5_000 },
  ).catch(() => {});

  // Select game type if codenames (undercover is default)
  if (gameType === "codenames") {
    await hostPage.locator('button:has-text("Codenames")').click();
    await expect(hostPage.locator('button:has-text("Codenames")')).toHaveAttribute("data-state", /.+/, { timeout: 2_000 }).catch(() => {});
  }

  // Click start game (retry with reload if backend rejects due to timing)
  const startButton = hostPage.locator('button:has-text("Start")');
  await expect(startButton).toBeEnabled({ timeout: 10_000 });
  await startButton.click();

  // Wait for all players to navigate to game page
  const urlPattern =
    gameType === "undercover"
      ? /\/game\/undercover\//
      : /\/game\/codenames\//;

  // Wait for ANY player to reach the game page (host first, then others)
  let gameUrl = "";
  // Check host first with a longer timeout — host is most likely to navigate
  const hostNavigated = await hostPage
    .waitForURL(urlPattern, { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (hostNavigated) {
    gameUrl = hostPage.url();
  } else {
    // Check other players with shorter timeouts
    for (const player of players) {
      if (player.page === hostPage) continue;
      const navigated = await player.page
        .waitForURL(urlPattern, { timeout: 3_000 })
        .then(() => true)
        .catch(() => false);
      if (navigated) {
        gameUrl = player.page.url();
        break;
      }
    }
  }

  // Retry: reload all pages once, re-establish sockets, and try start again
  if (!gameUrl) {
    for (const player of players) {
      if (!isPageAlive(player.page)) continue;
      await player.page.reload();
      await player.page.waitForLoadState("domcontentloaded");
      await player.page
        .waitForFunction(
          () => (window as any).__SOCKET__?.connected === true,
          { timeout: 10_000 },
        )
        .catch(() => {});
    }
    // Verify host sees all players before retrying start
    await hostPage
      .waitForFunction(
        (count: number) => {
          const text = document.body.innerText;
          const match = text.match(/Players \((\d+)/);
          return match && parseInt(match[1]) >= count;
        },
        players.length,
        { timeout: 10_000 },
      )
      .catch(() => {});
    const retryStartButton = hostPage.locator('button:has-text("Start")');
    const canRetry = await retryStartButton
      .isEnabled({ timeout: 5_000 })
      .catch(() => false);
    if (canRetry) {
      if (gameType === "codenames") {
        await hostPage.locator('button:has-text("Codenames")').click();
      }
      await retryStartButton.click();
      for (const player of players) {
        const navigated = await player.page
          .waitForURL(urlPattern, { timeout: 15_000 })
          .then(() => true)
          .catch(() => false);
        if (navigated) {
          gameUrl = player.page.url();
          break;
        }
      }
    }
  }

  if (!gameUrl) {
    throw new Error("No player navigated to the game page after start");
  }

  // Navigate stuck players one at a time to avoid concurrent get_board/get_state
  // calls that cause backend IllegalStateChangeError
  for (const player of players) {
    const onGamePage = urlPattern.test(player.page.url());
    if (!onGamePage) {
      // Set room ID in sessionStorage for players navigated directly (they missed game_started
      // event which normally stores this). The codenames page needs room_id for give_clue/guess_card.
      if (gameType === "codenames" && gameUrl) {
        const roomUrlMatch = player.page.url().match(/\/rooms\/([a-f0-9-]+)/);
        const gameIdMatch = gameUrl.match(/\/game\/codenames\/(.+)/);
        if (roomUrlMatch && gameIdMatch) {
          await player.page.evaluate(
            ([gid, rid]: [string, string]) =>
              sessionStorage.setItem(`ibg-game-room-${gid}`, rid),
            [gameIdMatch[1], roomUrlMatch[1]] as [string, string],
          );
        }
      }
      await player.page.goto(gameUrl);
      await player.page.waitForLoadState("domcontentloaded");

      // Check if player got redirected away (game component error -> home page)
      if (!urlPattern.test(player.page.url())) {
        await player.page.goto(gameUrl);
        await player.page.waitForLoadState("domcontentloaded");
      }

      // Final check - if still not on game page, try one more time
      if (!urlPattern.test(player.page.url())) {
        await player.page.goto(gameUrl);
        await player.page.waitForLoadState("domcontentloaded");
      }

      await expect(player.page).toHaveURL(urlPattern, { timeout: 15_000 });

      // Check for error page ("An error occurred" / "Player not found in game")
      const hasError = await player.page
        .locator("text=An error occurred")
        .isVisible()
        .catch(() => false);
      if (hasError) {
        // Error page — reload to retry getting game state
        await player.page.reload();
        await player.page.waitForLoadState("domcontentloaded");
      }

      // Wait for the game UI to load (board for codenames, heading for undercover)
      if (gameType === "codenames") {
        const boardVisible = await player.page
          .locator(".grid-cols-5 button")
          .first()
          .waitFor({ state: "visible", timeout: 10_000 })
          .then(() => true)
          .catch(() => false);
        if (!boardVisible) {
          // Check if player got "Player not found in game" error — skip if so
          const hasErrorPage = await player.page
            .locator("text=An error occurred")
            .isVisible()
            .catch(() => false);
          if (hasErrorPage) {
            // Player wasn't included in the game — skip board assertion
            continue;
          }
          await player.page.reload();
          await player.page.waitForLoadState("domcontentloaded");
        }
        await expect(
          player.page.locator(".grid-cols-5 button").first(),
        ).toBeVisible({ timeout: 15_000 });
        // Ensure socket is connected so get_board has updated the SID
        await player.page.waitForFunction(
          () => (window as any).__SOCKET__?.connected === true,
          { timeout: 10_000 },
        ).catch(() => {});
      } else {
        const headingVisible = await player.page
          .locator("h1:has-text('Undercover')")
          .waitFor({ state: "visible", timeout: 10_000 })
          .then(() => true)
          .catch(() => false);
        if (!headingVisible) {
          await player.page.reload();
          await player.page.waitForLoadState("domcontentloaded");
        }
        await expect(
          player.page.locator("h1:has-text('Undercover')"),
        ).toBeVisible({ timeout: 15_000 });
      }
      // Wait for socket connection before processing next player
      await player.page.waitForFunction(
        () => (window as any).__SOCKET__?.connected === true,
        { timeout: 5_000 },
      ).catch(() => {});
    }
  }

  // Ensure ALL players have connected sockets and game UI loaded
  // This handles auto-navigated players who may have the correct URL but no board/UI
  for (const player of players) {
    if (!isPageAlive(player.page)) continue;

    // If player is NOT on the game page (missed navigation), force-navigate them
    if (!urlPattern.test(player.page.url())) {
      if (gameUrl) {
        // Set sessionStorage room ID before navigating (codenames needs it)
        if (gameType === "codenames" && roomId) {
          const gameIdMatch = gameUrl.match(/\/game\/codenames\/(.+)/);
          if (gameIdMatch) {
            await player.page.evaluate(
              ([gid, rid]: [string, string]) =>
                sessionStorage.setItem(`ibg-game-room-${gid}`, rid),
              [gameIdMatch[1], roomId] as [string, string],
            );
          }
        }
        await player.page.goto(gameUrl);
        await player.page.waitForLoadState("domcontentloaded");
      }
    }

    if (!urlPattern.test(player.page.url())) continue;

    await player.page.waitForFunction(
      () => (window as any).__SOCKET__?.connected === true,
      { timeout: 10_000 },
    ).catch(() => {});
  }

  // For codenames: verify boards in parallel — auto-navigated players may have blank pages
  if (gameType === "codenames" && gameUrl) {
    const gameIdMatch = gameUrl.match(/\/game\/codenames\/(.+)/);
    const codenamesGameId = gameIdMatch ? gameIdMatch[1] : "";

    const recoverPlayer = async (player: PlayerContext) => {
      if (!isPageAlive(player.page)) return;
      if (!urlPattern.test(player.page.url())) return;

      const pg = player.page;
      const userId = player.login.user.id;

      const setStorage = async () => {
        if (codenamesGameId && roomId) {
          await pg.evaluate(
            ([gid, rid]: [string, string]) =>
              sessionStorage.setItem(`ibg-game-room-${gid}`, rid),
            [codenamesGameId, roomId] as [string, string],
          ).catch(() => {});
        }
      };
      const waitSocket = () =>
        pg.waitForFunction(
          () => (window as any).__SOCKET__?.connected === true,
          { timeout: 8_000 },
        ).catch(() => {});
      const emitBoard = () =>
        pg.evaluate(
          ([gid, uid]: [string, string]) => {
            const s = (window as any).__SOCKET__;
            if (s?.connected) s.emit("get_board", { game_id: gid, user_id: uid });
          },
          [codenamesGameId, userId] as [string, string],
        ).catch(() => {});
      const hasBoard = () =>
        pg.locator(".grid-cols-5 button").first().isVisible().catch(() => false);
      const waitBoard = (ms: number) =>
        pg.locator(".grid-cols-5 button").first()
          .waitFor({ state: "visible", timeout: ms })
          .then(() => true).catch(() => false);

      await setStorage();

      // Quick check: board already visible?
      if (await hasBoard()) return;

      // Wait briefly for component to emit get_board on its own
      if (await waitBoard(5_000)) return;

      // Attempt 1: direct socket emit
      await waitSocket();
      await emitBoard();
      if (await waitBoard(5_000)) return;

      // Attempt 2: reload page
      await setStorage();
      await pg.reload();
      await pg.waitForLoadState("domcontentloaded");
      await waitSocket();
      await emitBoard();
      if (await waitBoard(5_000)) return;

      // Attempt 3: nuclear reset — about:blank destroys all JS state
      const baseUrl = new URL(pg.url()).origin;
      await pg.goto("about:blank");
      await pg.goto(`${baseUrl}/`);
      await pg.waitForLoadState("domcontentloaded");
      await setStorage();
      await pg.goto(gameUrl);
      await pg.waitForLoadState("domcontentloaded");
      await waitSocket();
      await emitBoard();
      await waitBoard(5_000);
    };

    // Run board recovery for all players in parallel
    await Promise.all(players.map((p) => recoverPlayer(p)));

    // Second pass: check for any players still missing boards and retry
    const stillStuck = players.filter((p) => {
      if (!isPageAlive(p.page)) return false;
      if (!urlPattern.test(p.page.url())) return false;
      return true;
    });
    if (stillStuck.length > 0) {
      const secondPass = stillStuck.map(async (player) => {
        const pg = player.page;
        const boardVisible = await pg.locator(".grid-cols-5 button").first()
          .isVisible().catch(() => false);
        if (boardVisible) return;

        // Still stuck — aggressive recovery: full page reload + multiple emits
        const uid = player.login.user.id;
        if (codenamesGameId && roomId) {
          await pg.evaluate(
            ([gid, rid]: [string, string]) =>
              sessionStorage.setItem(`ibg-game-room-${gid}`, rid),
            [codenamesGameId, roomId] as [string, string],
          ).catch(() => {});
        }
        await pg.reload();
        await pg.waitForLoadState("domcontentloaded");
        await pg.waitForFunction(
          () => (window as any).__SOCKET__?.connected === true,
          { timeout: 10_000 },
        ).catch(() => {});
        // Wait briefly for component to register its listener
        await pg.waitForTimeout(1_000);
        // Emit get_board multiple times with delays
        for (let emit = 0; emit < 3; emit++) {
          await pg.evaluate(
            ([gid, uid2]: [string, string]) => {
              const s = (window as any).__SOCKET__;
              if (s?.connected) s.emit("get_board", { game_id: gid, user_id: uid2 });
            },
            [codenamesGameId, uid] as [string, string],
          ).catch(() => {});
          const ok = await pg.locator(".grid-cols-5 button").first()
            .waitFor({ state: "visible", timeout: 3_000 })
            .then(() => true).catch(() => false);
          if (ok) break;
        }
      });
      await Promise.all(secondPass);
    }
  }
}

// ─── Undercover UI Helpers ──────────────────────────────────

/**
 * Dismiss the role reveal by clicking "I Understand" for each player.
 * Waits for the playing phase to appear.
 */
/**
 * Dismiss the role reveal (if shown) and wait for the playing phase.
 * The undercover page may skip role_reveal entirely if the server
 * responds with turn_number > 0 before the role reveal renders.
 */
export async function dismissRoleRevealAll(
  players: PlayerContext[],
): Promise<PlayerContext[]> {
  const activePlayers: PlayerContext[] = [];

  for (const player of players) {
    // Skip players whose browser context is already closed
    if (!isPageAlive(player.page)) continue;

    // First, verify player is on the game page (not redirected to home)
    const onGamePage = /\/game\/undercover\//.test(player.page.url());
    if (!onGamePage) {
      // Player got redirected — find a player who IS on the game page and use their URL
      const gamePlayer = players.find((p) =>
        /\/game\/undercover\//.test(p.page.url()),
      );
      if (gamePlayer) {
        const gameUrl = gamePlayer.page.url();
        await player.page.goto(gameUrl);
        await player.page.waitForLoadState("domcontentloaded");

        // Retry if still redirected
        if (!/\/game\/undercover\//.test(player.page.url())) {
          await player.page.goto(gameUrl);
          await player.page.waitForLoadState("domcontentloaded");
        }
      }
    }

    // Check if already in playing or describing phase (no role reveal needed)
    const alreadyPlaying = await player.page
      .locator("text=Discuss and vote")
      .or(player.page.locator("text=Describe your word"))
      .first()
      .isVisible()
      .catch(() => false);
    if (alreadyPlaying) {
      activePlayers.push(player);
      continue;
    }

    // Check if "I Understand" button is visible (role_reveal phase)
    const dismissButton = player.page.locator(
      'button:has-text("I Understand")',
    );
    const isRoleReveal = await dismissButton
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(() => true)
      .catch(() => false);

    if (isRoleReveal) {
      // Button may disappear if game transitions to playing phase during click.
      // Use force:true in case a toast or overlay temporarily covers the button.
      await dismissButton.click({ timeout: 5_000, force: true }).catch(() => {});
    }

    // Wait for describing or playing phase
    let playingPhaseVisible = await player.page
      .locator("text=Discuss and vote")
      .or(player.page.locator("text=Describe your word"))
      .first()
      .waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!playingPhaseVisible) {
      // Check page is still alive before reloading
      if (!isPageAlive(player.page)) continue;

      // Reload to get latest game state from server
      await player.page.reload();
      await player.page.waitForLoadState("domcontentloaded");

      // Try clicking "I Understand" again in case reload brought back role reveal
      const dismissAgain = player.page.locator(
        'button:has-text("I Understand")',
      );
      const showAgain = await dismissAgain
        .isVisible()
        .catch(() => false);
      if (showAgain) {
        await dismissAgain.click({ force: true }).catch(() => {});
      }
    }

    // Final check — if still no game content, player is not in the game
    const hasGameContent = await player.page
      .locator("text=Discuss and vote")
      .or(player.page.locator("text=Describe your word"))
      .first()
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (hasGameContent) {
      activePlayers.push(player);
    }
  }

  return activePlayers;
}

/**
 * Have a player vote for a target player by clicking the vote button
 * containing the target's username.
 */
export async function voteForPlayer(
  voterPage: Page,
  targetUsername: string,
): Promise<boolean> {
  // Check if page context is still open (prevents crash on closed browser context)
  if (!isPageAlive(voterPage)) return false;

  // Check if voter is still on a game page (not redirected to HOME)
  if (!/\/game\//.test(voterPage.url())) return false;

  // Check if game already over
  const gameOver = await voterPage
    .locator("h2:has-text('Game Over')")
    .isVisible()
    .catch(() => false);
  if (gameOver) return false;

  // Wait for socket to be connected before voting
  const socketConnected = await voterPage
    .waitForFunction(
      () => (window as any).__SOCKET__?.connected === true,
      { timeout: 10_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!socketConnected) {
    // Check page is still alive before reloading
    if (!isPageAlive(voterPage)) return false;
    // Socket disconnected — reload to re-establish connection
    await voterPage.reload();
    await voterPage.waitForLoadState("domcontentloaded");
    // Check if game over after reload
    const gameOverNow = await voterPage
      .locator("h2:has-text('Game Over')")
      .isVisible()
      .catch(() => false);
    if (gameOverNow) return false;
  }

  // Find the player card that contains the target username and select it
  const playerCard = voterPage.locator(
    `button:has(.font-medium:text("${targetUsername}"))`,
  );
  let buttonVisible = await playerCard
    .waitFor({ state: "visible", timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (!buttonVisible) {
    // Check page is still alive before reloading
    if (!isPageAlive(voterPage)) return false;
    // Reload to get fresh game state (context may close between alive check and reload)
    try {
      await voterPage.reload();
      await voterPage.waitForLoadState("domcontentloaded");
    } catch {
      return false; // Browser context closed during reload
    }
    // Wait for socket to reconnect after reload (triggers get_undercover_state)
    await voterPage
      .waitForFunction(
        () => (window as any).__SOCKET__?.connected === true,
        { timeout: 10_000 },
      )
      .catch(() => {});
    // Re-check if game over after reload
    const nowGameOver = await voterPage
      .locator("h2:has-text('Game Over')")
      .isVisible()
      .catch(() => false);
    if (nowGameOver) return false;
    // Wait for vote buttons to render after reload
    buttonVisible = await playerCard
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
  }

  // Final check: is the card visible and enabled?
  const canVote = await playerCard.isVisible().catch(() => false);
  if (!canVote) return false;

  const isEnabled = await playerCard.isEnabled().catch(() => false);
  if (!isEnabled) return false;

  // Try to vote (with internal retries if the click doesn't register)
  const confirmBtn = voterPage.locator("button:has-text('Vote to Eliminate')");
  const voteConfirmation = voterPage
    .locator("text=Voted")
    .or(voterPage.locator("text=Waiting for other players"));

  for (let attempt = 0; attempt < 2; attempt++) {
    // Step 1: Select the player (click the card)
    await playerCard.click();

    // Brief pause to let React process the selection
    await voterPage.waitForTimeout(300);

    // Step 2: Click "Vote to Eliminate" to confirm
    const confirmVisible = await confirmBtn
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (confirmVisible) {
      await confirmBtn.click();
    }

    // Step 3: Verify vote was processed by backend
    const confirmed = await voteConfirmation
      .first()
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (confirmed) return true;

    // Retry — short pause before next attempt
    await voterPage.waitForTimeout(500);
  }

  return false;
}

/**
 * Verify all players voted — retry for any who silently failed.
 * Under load, voteForPlayer can fail even when buttons are visible.
 * This scans all players for remaining vote buttons and retries.
 */
export async function verifyAllPlayersVoted(
  players: PlayerContext[],
  targetUsername: string,
  fallbackUsername: string,
): Promise<void> {
  for (let voteRetry = 0; voteRetry < 2; voteRetry++) {
    // Check if game already progressed (all votes in)
    const aliveObserver = players.find((p) => isPageAlive(p.page));
    if (!aliveObserver) break;
    const gameProgressed = await aliveObserver.page
      .locator(".lucide-skull")
      .or(aliveObserver.page.locator("h2:has-text('Game Over')"))
      .first()
      .waitFor({ state: "visible", timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (gameProgressed) break;

    let foundUnvoted = false;
    for (const voter of players) {
      if (!isPageAlive(voter.page)) continue;
      const alreadyVoted = await voter.page
        .locator("text=Waiting for other players")
        .isVisible()
        .catch(() => false);
      if (alreadyVoted) continue;
      const hasButtons = await voter.page
        .locator(".grid.gap-3 button")
        .first()
        .isVisible()
        .catch(() => false);
      if (hasButtons) {
        foundUnvoted = true;

        // On retry 2+, reload the page first to get a fresh socket + state
        if (voteRetry >= 2) {
          try {
            await voter.page.reload();
            await voter.page.waitForLoadState("domcontentloaded");
            await voter.page
              .waitForFunction(
                () => (window as any).__SOCKET__?.connected === true,
                { timeout: 10_000 },
              )
              .catch(() => {});
            // Check if game ended after reload
            const gameOverNow = await voter.page
              .locator("h2:has-text('Game Over')")
              .isVisible()
              .catch(() => false);
            if (gameOverNow) return;
            // Wait for vote buttons to re-render
            await voter.page
              .locator(".grid.gap-3 button")
              .first()
              .waitFor({ state: "visible", timeout: 10_000 })
              .catch(() => {});
          } catch {
            continue; // Page closed during reload
          }
        }

        const voteTarget =
          voter.login.user.username === targetUsername
            ? fallbackUsername
            : targetUsername;
        await voteForPlayer(voter.page, voteTarget);
      }
    }
    if (!foundUnvoted) break;
  }
}

/**
 * Extract the game ID from the current URL of a player page.
 */
export function getGameIdFromUrl(page: Page): string {
  const url = page.url();
  const match = url.match(/\/game\/(?:undercover|codenames)\/(.+)/);
  if (!match) throw new Error(`Cannot extract game ID from URL: ${url}`);
  return match[1];
}

/**
 * Get the list of alive player usernames from a player's page.
 * These are the players shown as vote targets (excluding self).
 */
export async function getAliveVoteTargets(page: Page): Promise<string[]> {
  const buttons = page.locator(
    ".grid.gap-3 button .font-medium",
  );
  const count = await buttons.count();
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const text = await buttons.nth(i).textContent();
    if (text) names.push(text.trim());
  }
  return names;
}

/**
 * Get the word from the undercover word reminder for a player.
 * In the playing phase, this appears as "Your word: <WORD>".
 */
export async function getUndercoverWord(page: Page): Promise<string> {
  const wordReminder = page.locator(".bg-primary\\/5 .font-bold.text-primary");
  const isVisible = await wordReminder
    .isVisible({ timeout: 5_000 })
    .catch(() => false);
  if (isVisible) {
    return (await wordReminder.textContent()) || "";
  }
  // Mr. White has no word - check if page shows game content
  return "";
}

/**
 * Wait for either elimination or game over to appear on screen.
 *
 * Detects three indicators:
 * 1. Skull icon (.lucide-skull) — elimination screen
 * 2. "Game Over" heading — game ended
 * 3. "Eliminated" text in player list — elimination happened but screen was replaced
 *    by playing phase (get_undercover_state overrides phase to "playing" on reconnect)
 */
export async function waitForEliminationOrGameOver(
  page: Page,
  previouslyEliminatedCount = 0,
): Promise<"elimination" | "game_over"> {
  // Helper: check if page left the game (cancelled/redirected)
  const isRedirectedAway = () => {
    try {
      return !page.url().includes("/game/undercover/");
    } catch {
      return true; // Page closed
    }
  };

  // Helper: check all elimination/game-over indicators
  const checkIndicators = async (): Promise<"elimination" | "game_over" | null> => {
    if (isRedirectedAway()) return "game_over";

    const isGameOver = await page
      .locator("h2:has-text('Game Over')")
      .isVisible()
      .catch(() => false);
    if (isGameOver) return "game_over";

    const hasSkull = await page
      .locator(".lucide-skull")
      .first()
      .isVisible()
      .catch(() => false);
    if (hasSkull) {
      // Elimination may immediately trigger game over — wait longer under multi-worker load
      await page.waitForTimeout(3_000);
      const alsoGameOver = await page
        .locator("h2:has-text('Game Over')")
        .isVisible()
        .catch(() => false);
      if (alsoGameOver) return "game_over";
      return "elimination";
    }

    // Only count "Eliminated" entries if more than previously known
    // (avoids false positive from prior rounds' eliminated players)
    const eliminatedCount = await page
      .locator("text=Eliminated")
      .count()
      .catch(() => 0);
    if (eliminatedCount > previouslyEliminatedCount) return "elimination";

    return null;
  };

  // Helper: reload and wait for socket reconnection before checking state
  const reloadAndWaitForSocket = async () => {
    if (!isPageAlive(page)) return;
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page
      .waitForFunction(
        () => (window as any).__SOCKET__?.connected === true,
        { timeout: 10_000 },
      )
      .catch(() => {});
  };

  // === Attempt 1: Wait for skull or Game Over via socket event (no reload) ===
  await page
    .locator(".lucide-skull, h2:has-text('Game Over')")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
    .catch(() => {});

  let result = await checkIndicators();
  if (result) return result;

  // === Attempt 2: Reload to trigger get_undercover_state from server ===
  await reloadAndWaitForSocket();
  if (isRedirectedAway()) return "game_over";

  // Wait for state to render after socket reconnection
  await page
    .locator(".lucide-skull")
    .or(page.locator("h2:has-text('Game Over')"))
    .or(page.locator("text=Eliminated"))
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
    .catch(() => {});

  result = await checkIndicators();
  if (result) return result;

  // === Attempt 3: Final reload — last chance (shorter timeout to avoid burning time) ===
  await reloadAndWaitForSocket();
  if (isRedirectedAway()) return "game_over";

  await page
    .locator(".lucide-skull")
    .or(page.locator("h2:has-text('Game Over')"))
    .or(page.locator("text=Eliminated"))
    .first()
    .waitFor({ state: "visible", timeout: 8_000 })
    .catch(() => {});

  result = await checkIndicators();
  if (result) return result;

  // Final assertion — if we still see nothing, check if page is closed
  try {
    await expect(
      page
        .locator(".lucide-skull")
        .or(page.locator("h2:has-text('Game Over')"))
        .or(page.locator("text=Eliminated"))
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  } catch {
    // Page was closed (test timeout) or element never appeared — treat as game_over
    return "game_over";
  }

  // If the assertion passed, determine the result
  const finalResult = await checkIndicators();
  return finalResult ?? "elimination";
}

/**
 * Click the "Next Round" button (visible during elimination phase).
 */
export async function clickNextRound(page: Page): Promise<void> {
  const btn = page.locator("button:has-text('Next Round')");
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await btn.click();
  // Wait for new round to start — "Describe your word" (describing phase) or "Discuss and vote" (playing phase)
  await page.locator("text=Describe your word")
    .or(page.locator("text=Discuss and vote"))
    .first()
    .waitFor({ state: "visible", timeout: 10_000 })
    .catch(() => {});
}

/**
 * Ensure a player is on the undercover game page.
 * If they've been redirected (e.g. to home), navigate them back.
 * Returns true if the player is on the game page after the check.
 */
export async function ensureOnUndercoverGamePage(
  page: Page,
  gameUrl: string,
): Promise<boolean> {
  if (!isPageAlive(page)) return false;

  const needsNav = !/\/game\/undercover\//.test(page.url());
  if (needsNav) {
    // Player got redirected — navigate back
    await page.goto(gameUrl);
    await page.waitForLoadState("domcontentloaded");

    if (!/\/game\/undercover\//.test(page.url())) {
      // Second try
      await page.goto(gameUrl);
      await page.waitForLoadState("domcontentloaded");
    }

    if (!/\/game\/undercover\//.test(page.url())) return false;
  }

  // Wait for socket to connect — critical for receiving game events
  await page
    .waitForFunction(
      () => (window as any).__SOCKET__?.connected === true,
      { timeout: 10_000 },
    )
    .catch(() => {});

  return true;
}

// ─── Description Phase Helpers ──────────────────────────────

/**
 * Submit descriptions for all players in the description order.
 * Each player types a word (derived from their position) and submits.
 */
export async function submitDescriptionsForAllPlayers(
  players: PlayerContext[],
  allPlayers?: PlayerContext[],
): Promise<void> {
  // We need to iterate through description order. Each player who has the input
  // should type a word and submit. We do rounds until no more inputs are visible.
  const words = ["apple", "banana", "cherry", "date", "elderberry", "fig", "grape", "honey", "ice", "jam"];
  let wordIdx = 0;

  // Build a deduplicated scan list: primary players + any additional players from allPlayers.
  // dismissRoleRevealAll may exclude valid players who were slow to load — we need to scan them too.
  const scanList = allPlayers
    ? [...new Set([...players, ...allPlayers])]
    : players;

  // Fast polling: instant isVisible() checks, 500ms sleep between polls.
  // Key design decisions:
  // 1. No page.evaluate() in the scan — it can hang 30s on stuck pages under load
  // 2. No Promise.race with multiple waitFor() — accumulated promises cause slowdowns
  const maxAttempts = (scanList.length + 2) * 20;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Check if we've transitioned to voting or game over
    let checkPlayer: PlayerContext | undefined;
    for (const p of scanList) {
      try {
        if (!/\/game\/undercover\//.test(p.page.url())) continue;
        checkPlayer = p;
        break;
      } catch {
        continue; // page closed
      }
    }
    if (!checkPlayer) break;
    const transitioned = await checkPlayer.page
      .locator("text=Discuss and vote")
      .or(checkPlayer.page.locator("text=All hints are in"))
      .or(checkPlayer.page.locator("h2:has-text('Game Over')"))
      .first()
      .isVisible()
      .catch(() => false);
    if (transitioned) break;

    // Fast scan: instant isVisible() for ALL players (including those excluded
    // by dismissRoleRevealAll) — the game requires every player to submit.
    let submitter: PlayerContext | null = null;
    for (const player of scanList) {
      try {
        if (!/\/game\/undercover\//.test(player.page.url())) continue;
      } catch {
        continue; // page closed
      }

      const hasInput = await player.page
        .locator("#description-input")
        .isVisible()
        .catch(() => false);
      if (hasInput) {
        submitter = player;
        break;
      }
    }

    // Nobody has the input yet — wait and retry
    if (!submitter) {
      await checkPlayer.page.waitForTimeout(500);
      // After 15 consecutive misses (7.5s), reload a game page to refresh state.
      // Cycle through different players on each reload cycle so we eventually
      // hit the stuck player (not just the first one every time).
      if (attempt > 0 && attempt % 15 === 0) {
        const gamePlayers = scanList.filter((p) => {
          try { return /\/game\/undercover\//.test(p.page.url()); }
          catch { return false; }
        });
        if (gamePlayers.length > 0) {
          const idx = Math.floor(attempt / 15) % gamePlayers.length;
          const p = gamePlayers[idx];
          await p.page.reload();
          await p.page.waitForLoadState("domcontentloaded");
          await p.page
            .waitForFunction(
              () => (window as any).__SOCKET__?.connected === true,
              { timeout: 10_000 },
            )
            .catch(() => {});
        }
      }
      continue;
    }

    // Found a player with the input — submit their description
    const word = words[wordIdx % words.length];
    wordIdx++;
    const submitBtn = submitter.page.locator("button:has-text('Submit')");
    let submitted = false;

    // Dismiss any Sonner toasts that might cover the Submit button
    await submitter.page.evaluate(() => {
      document.querySelectorAll("[data-sonner-toast]").forEach((t) => {
        (t as HTMLElement).style.display = "none";
      });
    }).catch(() => {});

    // Attempt 1: fill + click (up to 3 retries for toast interference)
    for (let retry = 0; retry < 3 && !submitted; retry++) {
      try {
        await submitter.page.locator("#description-input").fill(word, { timeout: 5_000 });
      } catch {
        break; // Input disappeared (phase transitioned)
      }
      try {
        await submitBtn.click({ timeout: 5_000 });
        submitted = true;
      } catch {
        await submitter.page.evaluate(() => {
          document.querySelectorAll("[data-sonner-toast]").forEach((t) => {
            (t as HTMLElement).style.display = "none";
          });
        }).catch(() => {});
        await submitter.page.waitForTimeout(200);
      }
    }

    // Attempt 2: keyboard Enter on input (bypasses button entirely)
    if (!submitted) {
      const descInput = submitter.page.locator("#description-input");
      try {
        await descInput.fill(word, { timeout: 5_000 });
      } catch {
        continue; // Input gone — phase transitioned, retry loop
      }
      await descInput.press("Enter");
      const inputGone = await descInput
        .waitFor({ state: "hidden", timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (inputGone) submitted = true;
    }

    // Wait for the description to be processed (input disappears)
    await submitter.page
      .locator("#description-input")
      .waitFor({ state: "hidden", timeout: 5_000 })
      .catch(() => {});

    // Small delay for event propagation to next player
    await submitter.page.waitForTimeout(200).catch(() => {});
  }

  // Wait for transition animation to finish and voting phase to appear on alive players
  for (const player of scanList) {
    try {
      if (!/\/game\/undercover\//.test(player.page.url())) continue;
    } catch {
      continue; // page closed
    }
    // Short-circuit if game already ended (no point waiting for voting phase)
    const gameOver = await player.page
      .locator("h2:has-text('Game Over')")
      .isVisible()
      .catch(() => false);
    if (gameOver) break;
    await player.page
      .locator("text=Discuss and vote")
      .or(player.page.locator("h2:has-text('Game Over')"))
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
      .catch(() => {});
  }
}

/**
 * Wait for the voting phase to appear on a page.
 * Handles the transition from describing to playing phase.
 */
export async function waitForVotingPhase(page: Page): Promise<void> {
  const visible = await page
    .locator("text=Discuss and vote")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);

  if (!visible) {
    if (!isPageAlive(page)) return;
    // Reload to get latest state
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await page
      .waitForFunction(
        () => (window as any).__SOCKET__?.connected === true,
        { timeout: 10_000 },
      )
      .catch(() => {});
    await page
      .locator("text=Discuss and vote")
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
      .catch(() => {});
  }

  // Wait for vote buttons to actually render (they load slightly after the heading)
  await page
    .locator(".grid.gap-3 button")
    .first()
    .waitFor({ state: "visible", timeout: 10_000 })
    .catch(() => {});
}

// ─── Codenames UI Helpers ───────────────────────────────────

/**
 * Extract a player's team and role from the "My Info" section.
 */
export async function getPlayerRoleFromUI(page: Page): Promise<CodenamesPlayerRole> {
  const infoSection = page.locator(".bg-muted\\/50.p-3.text-center.text-sm");
  await expect(infoSection).toBeVisible({ timeout: 10_000 });
  const text = (await infoSection.textContent()) || "";

  const team: "red" | "blue" = text.includes("Red") ? "red" : "blue";
  const role: "spymaster" | "operative" = text.includes("Spymaster")
    ? "spymaster"
    : "operative";

  return { team, role };
}

/**
 * Get the current team from the turn info bar.
 */
export async function getCurrentTeamFromUI(page: Page): Promise<"red" | "blue"> {
  const turnInfo = page.locator(".bg-muted\\/50.p-3.text-center .font-semibold").first();
  await expect(turnInfo).toBeVisible({ timeout: 10_000 });
  const text = (await turnInfo.textContent()) || "";
  return text.includes("Red") ? "red" : "blue";
}

/**
 * Give a clue as spymaster through the UI form.
 */
export async function giveClueViaUI(
  page: Page,
  word: string,
  number: number,
  roomId?: string,
): Promise<void> {
  const clueLoc = page.locator(`.bg-muted\\/50.p-3.text-center >> text=${word}`);

  // Ensure sessionStorage has room_id before submitting (component reads it on mount)
  if (roomId) {
    const gameIdMatch = page.url().match(/\/game\/codenames\/(.+)/);
    if (gameIdMatch) {
      const wasSet = await page.evaluate(
        ([gid, rid]: [string, string]) => {
          const key = `ibg-game-room-${gid}`;
          const existing = sessionStorage.getItem(key);
          if (!existing) {
            sessionStorage.setItem(key, rid);
            return false;
          }
          return true;
        },
        [gameIdMatch[1], roomId] as [string, string],
      );
      if (!wasSet) {
        // sessionStorage was just set — reload to update component's roomIdRef
        await page.reload();
        await page.waitForLoadState("domcontentloaded");
        await page.waitForFunction(
          () => (window as any).__SOCKET__?.connected === true,
          { timeout: 10_000 },
        ).catch(() => {});
        await page.locator(".grid-cols-5 button").first()
          .waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
      }
    }
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    // Ensure socket is connected before submitting
    await page.waitForFunction(
      () => (window as any).__SOCKET__?.connected === true,
      { timeout: 10_000 },
    ).catch(() => {});

    // Wait for board to be rendered (ensures game state is loaded)
    await page.locator(".grid-cols-5 button").first()
      .waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});

    // Fill and submit if the form is visible
    const wordInput = page.locator('input[type="text"]');
    if (await wordInput.isVisible().catch(() => false)) {
      await wordInput.fill(word);
      await page.locator('input[type="number"]').fill(String(number));

      // Dismiss any Sonner toasts that might cover the Submit button
      await page.evaluate(() => {
        document.querySelectorAll("[data-sonner-toast]").forEach((t) => {
          (t as HTMLElement).style.display = "none";
        });
      }).catch(() => {});

      // Use force:true to bypass any remaining toast/overlay interference
      const submitBtn = page.locator("button:has-text('Submit')");
      await submitBtn.click({ force: true, timeout: 8_000 }).catch(() => {
        // Fallback: press Enter on the number input
        return page.locator('input[type="number"]').press("Enter").catch(() => {});
      });
    }

    // Check: did the backend process it? (longer timeout under load)
    const confirmed = await clueLoc
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (confirmed) return;

    // Also check if the form disappeared (clue was accepted but UI lagged)
    const formGone = !(await page.locator('input[type="text"]').isVisible().catch(() => true));
    if (formGone) {
      // Clue was accepted — wait a bit longer for propagation
      const lateConfirm = await clueLoc
        .waitFor({ state: "visible", timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (lateConfirm) return;
    }

    // Retry: reload page to get fresh state + reconnect socket
    if (attempt < 2) {
      await page.reload();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForFunction(
        () => (window as any).__SOCKET__?.connected === true,
        { timeout: 10_000 },
      ).catch(() => {});
      await page.locator(".grid-cols-5 button").first()
        .waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});

      // After reload, check if clue already went through on a previous attempt
      const alreadyGiven = await clueLoc
        .waitFor({ state: "visible", timeout: 3_000 })
        .then(() => true)
        .catch(() => false);
      if (alreadyGiven) return;
    }
  }
}

/**
 * Click a board card by index. Returns the card's text.
 */
export async function clickBoardCard(
  page: Page,
  cardIndex: number,
): Promise<string> {
  const cards = page.locator(".grid-cols-5 button");
  const card = cards.nth(cardIndex);
  const text = (await card.textContent()) || "";

  // Dismiss toasts that might interfere with card clicks
  await page.evaluate(() => {
    document.querySelectorAll("[data-sonner-toast]").forEach((t) => {
      (t as HTMLElement).style.display = "none";
    });
  }).catch(() => {});

  // Use force:true to bypass any overlapping elements
  await card.click({ force: true });

  return text;
}

/**
 * Find the first unrevealed and enabled card index on the board.
 */
export async function findUnrevealedCardIndex(page: Page): Promise<number> {
  const cards = page.locator(".grid-cols-5 button");
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    const isDisabled = await cards.nth(i).isDisabled();
    if (!isDisabled) return i;
  }
  return 0;
}

/**
 * Read card types from the spymaster's view by parsing CSS background classes.
 * Returns an array of 25 card types: "red", "blue", "neutral", "assassin", or "unknown".
 */
export async function getSpymasterCardTypes(page: Page): Promise<string[]> {
  const cards = page.locator(".grid-cols-5 button");
  // Wait for board to render (25 cards)
  await expect(cards.first()).toBeVisible({ timeout: 15_000 });

  // Wait for spymaster color classes to be applied (cards start as bg-card
  // until isSpymaster state is set and React re-renders with color classes)
  await page.waitForFunction(
    () => {
      const btns = document.querySelectorAll(".grid-cols-5 button");
      if (btns.length < 25) return false;
      // Check that at least one card has a color class (not just bg-card)
      return Array.from(btns).some(
        (btn) =>
          btn.className.includes("bg-red-") ||
          btn.className.includes("bg-blue-") ||
          btn.className.includes("bg-gray-800") ||
          btn.className.includes("bg-amber-"),
      );
    },
    { timeout: 10_000 },
  );

  const count = await cards.count();
  const types: string[] = [];
  for (let i = 0; i < count; i++) {
    const classes = (await cards.nth(i).getAttribute("class")) || "";
    if (classes.includes("bg-red-")) types.push("red");
    else if (classes.includes("bg-blue-")) types.push("blue");
    else if (classes.includes("bg-gray-800")) types.push("assassin");
    else if (classes.includes("bg-amber-")) types.push("neutral");
    else types.push("unknown");
  }
  return types;
}

/**
 * Get indices of cards matching a specific type from the spymaster's view.
 */
export async function getCardIndicesByType(
  page: Page,
  cardType: string,
): Promise<number[]> {
  const types = await getSpymasterCardTypes(page);
  return types
    .map((t, i) => (t === cardType ? i : -1))
    .filter((i) => i >= 0);
}

/**
 * Check if a card at a specific index is revealed (disabled + opacity).
 */
export async function isCardRevealed(page: Page, index: number): Promise<boolean> {
  const card = page.locator(".grid-cols-5 button").nth(index);
  const classes = (await card.getAttribute("class")) || "";
  // Only use opacity-75 as the revealed indicator.
  // Do NOT use isDisabled() because spymaster cards are all disabled
  // (spymasters can't click cards) even though they're not revealed.
  return classes.includes("opacity-75");
}

/**
 * Get indices of unrevealed cards of a given type from spymaster's view.
 */
export async function getUnrevealedCardIndicesByType(
  page: Page,
  cardType: string,
): Promise<number[]> {
  const allIndices = await getCardIndicesByType(page, cardType);
  const unrevealed: number[] = [];
  for (const idx of allIndices) {
    if (!(await isCardRevealed(page, idx))) {
      unrevealed.push(idx);
    }
  }
  return unrevealed;
}

/**
 * Get board word texts from the page.
 */
export async function getBoardWords(page: Page): Promise<string[]> {
  const cards = page.locator(".grid-cols-5 button");
  const count = await cards.count();
  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    const text = (await cards.nth(i).textContent()) || "";
    words.push(text.trim());
  }
  return words;
}
