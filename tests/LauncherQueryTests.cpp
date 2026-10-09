#include "ArchiveTestFixture.h"
#include "common/file.h"
#include "common/stringUtils.h"
#include "common/trophies.h"
#include "query/launcherQuery.h"

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <map>
#include <string>
#include <vector>

namespace {
namespace Trophies = Common::Trophies;
using Json = nlohmann::json;

void Check(bool value, const char *text) {
  if (!value) {
    std::fprintf(stderr, "LauncherQueryTests: failed: %s\n", text);
    std::abort();
  }
}

class TempDirectory {
public:
  TempDirectory() {
    const auto unique =
        std::chrono::steady_clock::now().time_since_epoch().count();
    m_path = std::filesystem::temp_directory_path() /
             ("kyty_launcher_query_test_" + std::to_string(unique));
    Check(std::filesystem::create_directories(m_path),
          "create temporary directory");
  }
  ~TempDirectory() {
    std::error_code error;
    std::filesystem::remove_all(m_path, error);
  }
  [[nodiscard]] const std::filesystem::path &Path() const { return m_path; }

private:
  std::filesystem::path m_path;
};

void WriteFile(const std::filesystem::path &path, const std::string &text) {
  std::filesystem::create_directories(path.parent_path());
  std::ofstream out(path, std::ios::binary);
  out << text;
  Check(out.good(), "write fixture file");
}

void WriteBigEndian(std::vector<char> &bytes, size_t offset, uint64_t value,
                    size_t length) {
  for (size_t i = 0; i < length; ++i) {
    bytes[offset + length - 1 - i] = static_cast<char>(value & 0xff);
    value >>= 8;
  }
}

// The trophy package layout Common::Trophies::LoadPackage reads.
void WritePackage(const std::filesystem::path &path,
                  const std::map<std::string, std::string> &files) {
  size_t offset = 0x40 + files.size() * 0x40;
  size_t size = offset;
  for (const auto &[name, contents] : files)
    size += contents.size();
  std::vector<char> bytes(size);
  WriteBigEndian(bytes, 0, 0xb228c60a, 4);
  WriteBigEndian(bytes, 4, 1, 4);
  WriteBigEndian(bytes, 8, bytes.size(), 8);
  WriteBigEndian(bytes, 0x10, files.size(), 4);
  WriteBigEndian(bytes, 0x14, 0x20, 4);
  size_t entry = 0x40;
  for (const auto &[name, contents] : files) {
    std::memcpy(bytes.data() + entry, name.data(), name.size());
    WriteBigEndian(bytes, entry + 0x20, offset, 8);
    WriteBigEndian(bytes, entry + 0x28, contents.size(), 8);
    std::memcpy(bytes.data() + offset, contents.data(), contents.size());
    offset += contents.size();
    entry += 0x40;
  }
  WriteFile(path, std::string(bytes.begin(), bytes.end()));
}

void TestArchives(const std::filesystem::path &directory) {
  const auto archive = directory / "game.zar";
  const std::vector<uint8_t> payload(16, 7);
  Check(ArchiveTests::CreateArchive(archive, payload), "create archive");
  const auto out = directory / "out";
  const auto result = Query::QueryArchives(
      Json{{"outDir", Common::PathToString(out)},
           {"archives",
            {Common::PathToString(archive),
             Common::PathToString(directory / "missing.zar")}}});
  Check(result.contains("archives") && result["archives"].size() == 2,
        "one result per archive");
  const auto &game = result["archives"][0];
  Check(game["ok"] == true && game["hasEboot"] == true,
        "archive opens and has eboot.bin");
  const auto param = game["files"]["sce_sys/param.json"];
  Check(param.is_string(), "param.json is extracted");
  std::ifstream in(Common::PathFromUtf8(param.get<std::string>()));
  const std::string text{std::istreambuf_iterator<char>(in),
                         std::istreambuf_iterator<char>()};
  Check(text == ArchiveTests::Param, "param.json content is copied");
  Check(game["files"]["sce_sys/icon0.png"].is_null(),
        "missing images are null");
  Check(result["archives"][1]["ok"] == false, "missing archive is reported");
  Check(Query::QueryArchives(Json::object()).contains("error"),
        "bad request is rejected");
}

void TestTrophies(const std::filesystem::path &directory) {
  const auto game = directory / "game";
  WriteFile(game / "eboot.bin", "ELF");
  WritePackage(
      game / "sce_sys/trophy2/trophy00.ucp",
      {{"tropconf.json", R"({"defaultLanguage":"en-US","trophies":[
			{"id":"0","grade":"P"},
			{"id":"1","grade":"G"},
			{"id":"2","grade":"B","hidden":true}
		]})"},
       {"tropmeta_en-US.json",
        R"({"metadata":{"titleMetadata":{"name":"Test game"},"trophyMetadata":[
			{"id":"1","name":"Gold one","detail":"Earn it."}
		]}})"},
       {"trop0001.png", "PNG"}});
  WriteFile(game / "sce_sys/trophy2/notes.txt", "ignored");
  const auto runtime = directory / "runtime";
  Trophies::UnlockData unlocks;
  unlocks.unlocked = {1};
  unlocks.timestamps[1] = Trophies::UnixEpochTick + 1'700'000'000'000'000ULL;
  Check(Trophies::SaveUnlockData(
            Trophies::UnlocksPath(runtime, "PPSA00001", 1000, 0), unlocks),
        "save unlocks");

  const Json game_request = {{"key", "g1"},
                             {"base", Common::PathToString(game)},
                             {"titleId", "PPSA00001"},
                             {"userId", 1000},
                             {"consoleLanguage", 1}};
  const auto icons = directory / "icons";
  const auto result = Query::QueryTrophies(
      Json{{"runtimeRoot", Common::PathToString(runtime)},
           {"iconDir", Common::PathToString(icons)},
           {"games", {game_request}}});
  Check(result["games"].size() == 1, "one game result");
  const auto &entry = result["games"][0];
  Check(entry["key"] == "g1" && entry["packages"].size() == 1,
        "one package found");
  const auto &package = entry["packages"][0];
  Check(package["title"] == "Test game" && package["serviceLabel"] == 0,
        "package title and label");
  Check(package["trophies"].size() == 3, "all trophies listed");
  const auto &gold = package["trophies"][1];
  Check(gold["name"] == "Gold one" && gold["unlocked"] == true,
        "unlocked trophy");
  Check(gold["unlockedAtMs"] == 1'700'000'000'000ULL,
        "unlock time in Unix milliseconds");
  Check(gold["icon"].is_string() &&
            std::filesystem::exists(
                Common::PathFromUtf8(gold["icon"].get<std::string>())),
        "trophy icon is written");
  Check(package["trophies"][2]["hidden"] == true, "hidden flag");
  Check(entry["summary"]["earned"] == 1 && entry["summary"]["total"] == 3,
        "summary counts");
  Check(entry["summary"]["percentage"] == 85, "gold is 6 of 7 points");

  const auto overview = Query::QueryTrophies(
      Json{{"runtimeRoot", Common::PathToString(runtime)},
           {"iconDir", nullptr},
           {"games", {game_request}}});
  Check(overview["games"][0]["packages"][0]["trophies"].empty(),
        "overview skips trophy details");
}
} // namespace

int main() {
  TempDirectory directory;
  TestArchives(directory.Path());
  TestTrophies(directory.Path());
  std::printf("LauncherQueryTests: all cases passed\n");
  return 0;
}
