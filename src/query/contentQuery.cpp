#include "common/archive.h"
#include "common/file.h"
#include "common/stringUtils.h"
#include "common/trophies.h"
#include "query/launcherQuery.h"

#include <algorithm>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <regex>
#include <string>
#include <vector>

namespace Query {

namespace {

namespace Trophies = Common::Trophies;
using Json         = nlohmann::json;

constexpr uint64_t MaxMetadataSize = uint64_t {1} << 20u;
constexpr uint64_t MaxImageSize    = uint64_t {32} << 20u;

// A game folder, or a path inside a .zar archive, the way the launcher addresses game files.
std::filesystem::path Resolve(const std::filesystem::path& base, const std::string& relative) {
	return Common::IsSupportedArchive(base)
	           ? Common::MakeArchivePath(base, Common::PathFromUtf8(relative))
	           : base / Common::PathFromUtf8(relative);
}

bool CopyFile(const std::filesystem::path& from, const std::filesystem::path& to,
              uint64_t max_size) {
	Common::File input(from, Common::File::Mode::Read);
	if (input.IsInvalid() || input.Size() > max_size) {
		return false;
	}
	const auto      bytes = input.ReadWholeBuffer();
	std::error_code error;
	std::filesystem::create_directories(to.parent_path(), error);
	Common::File output;
	if (!output.Create(to)) {
		return false;
	}
	uint32_t written = 0;
	output.Write(bytes.data(), static_cast<uint32_t>(bytes.size()), &written);
	return written == bytes.size();
}

// sce_sys/trophy2/trophyNN.ucp files, sorted by name, with their service labels.
std::vector<std::pair<std::string, uint32_t>> FindTrophyFiles(const std::filesystem::path& base) {
	static const std::regex                       pattern(R"(^trophy(\d+)\.ucp$)");
	std::vector<std::pair<std::string, uint32_t>> files;
	const auto directory = Resolve(base, Trophies::PackageDirectory);
	const bool archive   = Common::IsArchivePath(directory);
	for (const auto& entry: Common::File::GetDirEntries(directory)) {
		std::smatch match;
		if (!entry.is_file || !std::regex_match(entry.name, match, pattern)) {
			continue;
		}
		std::error_code error;
		if (!archive &&
		    std::filesystem::is_symlink(directory / Common::PathFromUtf8(entry.name), error)) {
			continue;
		}
		files.emplace_back(entry.name, static_cast<uint32_t>(std::stoul(match[1].str())));
	}
	std::sort(files.begin(), files.end());
	return files;
}

Json ProgressJson(const Trophies::Progress& progress) {
	return {{"total", progress.total},
	        {"earned", progress.earned},
	        {"percentage", progress.Percentage()},
	        {"totalGrade", progress.total_grade},
	        {"earnedGrade", progress.earned_grade}};
}

std::string SafeName(std::string text) {
	for (auto& c: text) {
		const bool safe = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
		                  (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '.';
		if (!safe) {
			c = '_';
		}
	}
	return text;
}

Json QueryGameTrophies(const Json& game, const std::filesystem::path& runtime_root,
                       const Json& icon_dir) {
	const auto key      = game.value("key", std::string());
	const auto base     = Common::PathFromUtf8(game.value("base", std::string()));
	const auto title_id = game.value("titleId", std::string());
	const int  user_id  = game.value("userId", 1000);
	const int  language = game.value("consoleLanguage", 1);
	const auto reader   = Common::OpenArchive(base);
	Json       result   = {{"key", key}, {"packages", Json::array()}, {"errors", Json::array()}};
	Trophies::Progress total;

	for (const auto& [file, label]: FindTrophyFiles(base)) {
		const auto path    = Resolve(base, std::string(Trophies::PackageDirectory) + "/" + file);
		const auto package = Trophies::LoadPackage(path, language);
		if (package.trophies.empty()) {
			result["errors"].push_back("Could not read trophy package " + file + ".");
			continue;
		}
		const auto unlocks =
		    Trophies::LoadUnlockData(Trophies::UnlocksPath(runtime_root, title_id, user_id, label));
		const auto progress = Trophies::GetProgress(package, unlocks);
		total.total += progress.total;
		total.earned += progress.earned;
		for (size_t grade = 1; grade < total.total_grade.size(); ++grade) {
			total.total_grade[grade] += progress.total_grade[grade];
			total.earned_grade[grade] += progress.earned_grade[grade];
		}

		Json entry = {{"file", file},
		              {"serviceLabel", label},
		              {"title", package.title},
		              {"progress", ProgressJson(progress)},
		              {"groups", Json::array()},
		              {"trophies", Json::array()}};
		for (const auto& [id, name]: package.groups) {
			entry["groups"].push_back({{"id", id}, {"name", name}});
		}
		if (!icon_dir.is_string()) {
			result["packages"].push_back(std::move(entry));
			continue;
		}
		const auto icons =
		    Common::PathFromUtf8(icon_dir.get<std::string>()) / SafeName(key) / SafeName(file);
		for (const auto& [id, trophy]: package.trophies) {
			Json item = {{"id", id},
			             {"groupId", trophy.group_id},
			             {"grade", trophy.grade},
			             {"hidden", trophy.hidden},
			             {"hasReward", trophy.has_reward},
			             {"name", trophy.name},
			             {"description", trophy.description},
			             {"reward", trophy.reward},
			             {"icon", nullptr},
			             {"unlocked", unlocks.unlocked.contains(id)},
			             {"unlockedAtMs", nullptr}};
			if (const auto stamp = unlocks.timestamps.find(id);
			    stamp != unlocks.timestamps.end() && stamp->second >= Trophies::UnixEpochTick) {
				item["unlockedAtMs"] = (stamp->second - Trophies::UnixEpochTick) / 1000;
			}
			if (!trophy.icon_png.empty()) {
				const auto      icon = icons / ("trophy" + std::to_string(id) + ".png");
				std::error_code error;
				std::filesystem::create_directories(icon.parent_path(), error);
				Common::File output;
				if (output.Create(icon)) {
					uint32_t written = 0;
					output.Write(trophy.icon_png.data(),
					             static_cast<uint32_t>(trophy.icon_png.size()), &written);
					if (written == trophy.icon_png.size()) {
						item["icon"] = Common::PathToString(icon);
					}
				}
			}
			entry["trophies"].push_back(std::move(item));
		}
		result["packages"].push_back(std::move(entry));
	}
	result["summary"] = ProgressJson(total);
	return result;
}

} // namespace

Json QueryArchives(const Json& request) {
	Json results = Json::array();
	if (!request.is_object() || !request.contains("archives") || !request["archives"].is_array() ||
	    !request.contains("outDir") || !request["outDir"].is_string()) {
		return {{"error", "Expected {outDir, archives}."}};
	}
	const auto out_dir = Common::PathFromUtf8(request["outDir"].get<std::string>());
	size_t     index   = 0;
	for (const auto& value: request["archives"]) {
		const auto path   = value.is_string() ? value.get<std::string>() : std::string();
		const auto base   = Common::PathFromUtf8(path);
		const auto target = out_dir / std::to_string(index++);
		Json item = {{"path", path}, {"ok", false}, {"hasEboot", false}, {"files", Json::object()}};
		const auto reader = Common::IsSupportedArchive(base) ? Common::OpenArchive(base) : nullptr;
		if (reader == nullptr) {
			results.push_back(std::move(item));
			continue;
		}
		item["ok"]       = true;
		item["hasEboot"] = Common::File::IsFileExisting(Resolve(base, "eboot.bin"));
		const std::pair<const char*, uint64_t> files[] = {
		    {"sce_sys/param.json", MaxMetadataSize},
		    {"sce_sys/icon0.png", MaxImageSize},
		    {"sce_sys/pic0.png", MaxImageSize},
		};
		for (const auto& [name, limit]: files) {
			const auto out      = target / Common::PathFromUtf8(name);
			item["files"][name] = CopyFile(Resolve(base, name), out, limit)
			                          ? Json(Common::PathToString(out))
			                          : Json(nullptr);
		}
		item["trophyFiles"] = Json::array();
		for (const auto& [file, label]: FindTrophyFiles(base)) {
			item["trophyFiles"].push_back(file);
		}
		results.push_back(std::move(item));
	}
	return {{"archives", results}};
}

Json QueryTrophies(const Json& request) {
	if (!request.is_object() || !request.contains("games") || !request["games"].is_array()) {
		return {{"error", "Expected {runtimeRoot, iconDir, games}."}};
	}
	const auto runtime_root = Common::PathFromUtf8(request.value("runtimeRoot", std::string()));
	const auto icon_dir     = request.contains("iconDir") ? request["iconDir"] : Json(nullptr);
	Json       games        = Json::array();
	for (const auto& game: request["games"]) {
		if (game.is_object()) {
			games.push_back(QueryGameTrophies(game, runtime_root, icon_dir));
		}
	}
	return {{"games", games}};
}

} // namespace Query
