#ifndef EMULATOR_INCLUDE_QUERY_LAUNCHERQUERY_H_
#define EMULATOR_INCLUDE_QUERY_LAUNCHERQUERY_H_

#include <nlohmann/json.hpp>
#include <string_view>

// "kyty_emulator --query <command>" answers questions for the launcher with the emulator's own
// code: which GPUs and microphones it sees, what is inside .zar game archives, and trophy
// packages. Each command prints one line, QueryResultPrefix followed by JSON, and exits.
namespace Query {

inline constexpr std::string_view QueryResultPrefix = "KYTY_QUERY_RESULT ";

inline constexpr int ExitOk         = 0;
inline constexpr int ExitBadRequest = 2;
inline constexpr int ExitFailure    = 3;

int Run(int argc, char* argv[]);

// Request: {"outDir": "...", "archives": ["/path/game.zar", ...]}. Copies sce_sys/param.json,
// icon0.png, pic0.png and the trophy packages of each archive into outDir/<index>/.
nlohmann::json QueryArchives(const nlohmann::json& request);

// Request: {"runtimeRoot": "...", "iconDir": "..." or null, "games": [{"key", "base", "titleId",
// "userId", "consoleLanguage"}]}. With a null iconDir only progress is returned.
nlohmann::json QueryTrophies(const nlohmann::json& request);

} // namespace Query

#endif /* EMULATOR_INCLUDE_QUERY_LAUNCHERQUERY_H_ */
