#include "query/launcherQuery.h"

#include "common/emulatorConfig.h"
#include "common/logging/log.h"
#include "graphics/presentation/window.h"
#include "kytyGitVersion.h"

#include <SDL3/SDL.h>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <deque>
#include <iostream>
#include <iterator>
#include <map>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <vector>

namespace Query {

namespace {

using Json = nlohmann::json;

void Print(std::string_view prefix, const Json& value) {
	const auto text = value.dump(-1, ' ', false, Json::error_handler_t::replace);
	std::fwrite(prefix.data(), 1, prefix.size(), stdout);
	std::fwrite(text.data(), 1, text.size(), stdout);
	std::fputc('\n', stdout);
	std::fflush(stdout);
}

Json ReadRequest() {
	const std::string text {std::istreambuf_iterator<char>(std::cin),
	                        std::istreambuf_iterator<char>()};
	return Json::parse(text, nullptr, false);
}

bool UpdateCheckSupported() {
#if defined(KYTY_OFFICIAL_BUILD) && KYTY_BUILD == KYTY_BUILD_RELEASE
	return !std::string_view(KYTY_GIT_HASH).ends_with("-dirty");
#else
	return false;
#endif
}

const char* BuildOrigin() {
#if defined(KYTY_OFFICIAL_BUILD)
	return "Official";
#elif defined(KYTY_FORK_BUILD)
	return "Fork";
#else
	return "Source";
#endif
}

Json Microphones(std::string& error) {
	Json names = Json::array();
	if (!SDL_InitSubSystem(SDL_INIT_AUDIO)) {
		error = SDL_GetError();
		return names;
	}
	int                   count   = 0;
	SDL_AudioDeviceID*    devices = SDL_GetAudioRecordingDevices(&count);
	std::set<std::string> seen;
	for (int i = 0; i < count; i++) {
		if (const char* name = SDL_GetAudioDeviceName(devices[i]);
		    name != nullptr && seen.insert(name).second) {
			names.push_back(name);
		}
	}
	SDL_free(devices);
	SDL_QuitSubSystem(SDL_INIT_AUDIO);
	return names;
}

Json Info() {
	Json result = {{"version", KYTY_VERSION},
	               {"gitVersion", KYTY_GIT_VERSION},
	               {"gitHash", KYTY_GIT_HASH},
	               {"buildLabel", KYTY_BUILD_LABEL},
	               {"origin", BuildOrigin()},
	               {"releaseTag", KYTY_RELEASE_TAG},
	               {"repository", KYTY_BUILD_REPOSITORY},
	               {"updateCheckSupported", UpdateCheckSupported()},
	               {"gpus", Json::array()},
	               {"microphones", Json::array()}};

	std::vector<Libs::Graphics::VulkanDeviceInfo> devices;
	std::string                                   gpu_error;
	if (Libs::Graphics::EnumerateVulkanDevices(devices, gpu_error)) {
		for (const auto& device: devices) {
			result["gpus"].push_back({{"index", device.index},
			                          {"name", device.name},
			                          {"type", device.type},
			                          {"apiVersion", device.api_version},
			                          {"vendorID", device.vendor_id},
			                          {"deviceID", device.device_id},
			                          {"driverVersion", device.driver_version},
			                          {"meetsRequirements", device.supports_target_api}});
		}
	} else {
		result["gpuError"] = gpu_error;
	}

	std::string mic_error;
	result["microphones"] = Microphones(mic_error);
	if (!mic_error.empty()) {
		result["micError"] = mic_error;
	}
	return result;
}

// Reads stdin lines on a thread so the SDL loop can poll them.
class LineReader {
public:
	LineReader(): m_thread([this] { Read(); }) { m_thread.detach(); }

	bool Next(std::string& line) {
		std::lock_guard lock(m_mutex);
		if (m_lines.empty()) {
			return false;
		}
		line = std::move(m_lines.front());
		m_lines.pop_front();
		return true;
	}

	[[nodiscard]] bool Closed() const { return m_closed; }

private:
	void Read() {
		std::string line;
		while (std::getline(std::cin, line)) {
			std::lock_guard lock(m_mutex);
			m_lines.push_back(line);
		}
		m_closed = true;
	}

	std::mutex              m_mutex;
	std::deque<std::string> m_lines;
	std::atomic_bool        m_closed = false;
	std::thread             m_thread;
};

// Previews the lightbar color on connected controllers (the Qt launcher's ControllerLightbar),
// and optionally reports buttons for launchers that cannot read the controller themselves.
int Controller() {
	constexpr std::string_view Prefix = "KYTY_CTRL ";
	if (!SDL_InitSubSystem(SDL_INIT_GAMEPAD)) {
		Print(Prefix, {{"event", "error"}, {"message", SDL_GetError()}});
		return ExitFailure;
	}
	std::map<SDL_JoystickID, SDL_Gamepad*>        gamepads;
	std::map<std::pair<SDL_JoystickID, int>, int> axes;
	bool                                          input = false;
	bool                                          led   = false;
	Uint8                                         red = 0, green = 0, blue = 0;
	LineReader                                    reader;

	const auto apply_led = [&](SDL_Gamepad* gamepad) {
		if (led) {
			SDL_SetGamepadLED(gamepad, red, green, blue);
		}
	};

	while (!reader.Closed()) {
		std::string line;
		while (reader.Next(line)) {
			if (line.starts_with("led #") && line.size() >= 11) {
				const auto value = std::strtoul(line.c_str() + 5, nullptr, 16);
				red              = static_cast<Uint8>((value >> 16u) & 0xffu);
				green            = static_cast<Uint8>((value >> 8u) & 0xffu);
				blue             = static_cast<Uint8>(value & 0xffu);
				led              = true;
				for (auto& [id, gamepad]: gamepads) {
					apply_led(gamepad);
				}
			} else if (line.starts_with("led off")) {
				led = false;
			} else if (line.starts_with("input on")) {
				input = true;
			} else if (line.starts_with("input off")) {
				input = false;
			}
		}

		SDL_Event event;
		while (SDL_PollEvent(&event)) {
			if (event.type == SDL_EVENT_GAMEPAD_ADDED && !gamepads.contains(event.gdevice.which)) {
				if (auto* gamepad = SDL_OpenGamepad(event.gdevice.which); gamepad != nullptr) {
					gamepads[event.gdevice.which] = gamepad;
					apply_led(gamepad);
					const char* name = SDL_GetGamepadName(gamepad);
					Print(Prefix, {{"event", "added"}, {"name", name != nullptr ? name : ""}});
				}
			} else if (event.type == SDL_EVENT_GAMEPAD_REMOVED) {
				if (auto it = gamepads.find(event.gdevice.which); it != gamepads.end()) {
					SDL_CloseGamepad(it->second);
					gamepads.erase(it);
					Print(Prefix, {{"event", "removed"}});
				}
			} else if (input && (event.type == SDL_EVENT_GAMEPAD_BUTTON_DOWN ||
			                     event.type == SDL_EVENT_GAMEPAD_BUTTON_UP)) {
				const char* name = SDL_GetGamepadStringForButton(
				    static_cast<SDL_GamepadButton>(event.gbutton.button));
				Print(Prefix, {{"event", "button"},
				               {"button", name != nullptr ? name : ""},
				               {"down", event.type == SDL_EVENT_GAMEPAD_BUTTON_DOWN}});
			} else if (input && event.type == SDL_EVENT_GAMEPAD_AXIS_MOTION) {
				// Report tenths, which is enough for menu navigation.
				const int  value = static_cast<int>(event.gaxis.value) * 10 / 32767;
				const auto key =
				    std::make_pair(event.gaxis.which, static_cast<int>(event.gaxis.axis));
				if (axes[key] != value) {
					axes[key] = value;
					const char* name =
					    SDL_GetGamepadStringForAxis(static_cast<SDL_GamepadAxis>(event.gaxis.axis));
					Print(Prefix, {{"event", "axis"},
					               {"axis", name != nullptr ? name : ""},
					               {"value", value / 10.0}});
				}
			}
		}
		std::this_thread::sleep_for(std::chrono::milliseconds(input ? 8 : 50));
	}

	for (auto& [id, gamepad]: gamepads) {
		SDL_CloseGamepad(gamepad);
	}
	SDL_QuitSubSystem(SDL_INIT_GAMEPAD);
	return ExitOk;
}

} // namespace

int Run(int argc, char* argv[]) {
	if (argc < 3) {
		std::fprintf(stderr, "--query needs a command: info, archives, trophies, controller\n");
		return ExitBadRequest;
	}
	// Keep the emulator's logging quiet: stdout carries the answer.
	Config::Initialize();
	Config::Load(Config::ConfigOptions {});
	Log::Initialize();

	const std::string_view command = argv[2];
	if (command == "info") {
		Print(QueryResultPrefix, Info());
		return ExitOk;
	}
	if (command == "controller") {
		return Controller();
	}
	if (command == "archives" || command == "trophies") {
		const auto request = ReadRequest();
		const auto result = command == "archives" ? QueryArchives(request) : QueryTrophies(request);
		Print(QueryResultPrefix, result);
		return result.contains("error") ? ExitBadRequest : ExitOk;
	}
	std::fprintf(stderr, "Unknown query: %.*s\n", static_cast<int>(command.size()), command.data());
	return ExitBadRequest;
}

} // namespace Query
