---
tags: [talishar, architecture, api-surface]
paths: []
strength: 1
source: "third_party/talishar/APIs/*.php; third_party/talishar/ProcessInput.php; third_party/talishar/GetUpdateSSE.php"
graduated: false
created: 2026-07-18
---

`third_party/talishar/APIs/` holds 46 frontend-facing REST endpoints (`ls third_party/talishar/APIs
| wc -l`, verified directly, matching `docs/TALISHAR-ARCHITECTURE.md`'s prior count — but this
surface moves with every merged PR, so re-verify the count before quoting it as exact). All
follow a shared shape: include `../HostFiles/Redirector.php` + `../Libraries/HTTPLibraries.php`,
call `SetHeaders()` for CORS, decode `$_POST` from `json_decode(file_get_contents('php://input'),
true)` (POST bodies are JSON, not form-encoded), return a `stdClass` response JSON-encoded.

Full file-by-file map, grouped by function:

- **Game lifecycle**: `CreateGame.php` (new game; `deck`/`fabdb` deckbuilder link, `format`,
  `visibility`, `deckTestMode` for solo-vs-AI), `JoinGame.php` (50.9K — the largest API file),
  `SubmitLobbyInput.php`, `ChooseFirstPlayer.php`, `GetInitialGameDataAPI.php` (loads
  `../Games/{gameName}/GameFile.txt` via `APIParseGamefile.php`), `APIParseGamefile.php`,
  `GetGameInfo.php`, `GetGameList.php` (12.5K), `GetLastActiveGame.php`, `KickPlayer.php`,
  `SubmitSideboard.php` (11.8K — matchup-specific sideboarding between games in a set).
- **Lobby**: `GetLobbyInfo.php` (9.7K), `GetLobbyRefresh.php` (10.5K), `CreateReplayGame.php`
  (9.8K), `CreateSharedReplayGame.php` (5.4K).
- **Replays**: `GetReplayTurns.php`, `GetSavedReplays.php`, `ShareReplay.php`,
  `SetReplayFavorite.php`.
- **Decks**: `AddFavoriteDeck.php`, `GetFavoriteDecks.php`, `UpdateFavoriteDeck.php`,
  `DeleteDeckAPI.php`, `GetDeckCards.php`, `LinkDeckbuilderAPI.php`, `SaveDeckCosmetics.php`,
  `GetCosmetics.php`.
- **Account/social**: `FriendListAPI.php` (7.1K), `BlockedUsersAPI.php`, `UserProfileAPI.php`
  (9.6K), `ChangeDisplayNameAPI.php`, `SearchUsernames.php`, `RecoverAuthKey.php`,
  `UsernameModeration.php` (8.4K), `GetModPageData.php` (6.4K).
- **Supporter-tier (Metafy, formerly Patreon)**: `MetafyAPI.php`, `CheckPatreonAPI.php`,
  `RefreshMetafyCommunities.php` (10.1K), `SyncMetafySubscribers.php` (10.4K).
- **Live-presence/chat**: `ChatTyping.php`, `CheckOpponentTyping.php` (superseded by SSE's `typing`
  event, see [[tal-arch-fe-state-flow]] — kept for fallback), `PlayerPresence.php`.
- **Misc/system**: `GetSystemMessage.php`, `SystemMessageAPI.php`, `DownloadStats.php`,
  `ClearRustCounters.php`.

Outside `APIs/`, the two highest-traffic endpoints live at the repo root instead:
`third_party/talishar/ProcessInput.php` (all in-game player actions — see
[[tal-arch-request-pipeline]]) and `third_party/talishar/GetUpdateSSE.php` (state delivery — see
[[tal-arch-fe-state-flow]]). `third_party/talishar/GetNextTurn.php` is the polling-fallback twin of
the SSE endpoint.
