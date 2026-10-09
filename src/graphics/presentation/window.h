#ifndef EMULATOR_INCLUDE_EMULATOR_GRAPHICS_WINDOW_H_
#define EMULATOR_INCLUDE_EMULATOR_GRAPHICS_WINDOW_H_

#include "common/abi.h"
#include "common/common.h"

#include <string>
#include <vector>

namespace Libs::Graphics {

class Presenter;

[[nodiscard]] Presenter& WindowInit(uint32_t width, uint32_t height);
void                     WindowRun();
void                     WindowShutdown();

// Points SDL at the bundled Vulkan loader where the platform needs one (MoltenVK on macOS).
void ConfigureVulkanLoaderPath();

struct VulkanDeviceInfo {
	uint32_t    index = 0;
	std::string name;
	std::string type;
	uint32_t    api_version    = 0;
	uint32_t    vendor_id      = 0;
	uint32_t    device_id      = 0;
	uint32_t    driver_version = 0;
	// The emulator needs Vulkan 1.3.
	bool supports_target_api = false;
};

// Lists the physical devices in the order "--gpu <index>" selects from, using the instance
// extensions the emulator's window enables (device-select layers may reorder by them). Never
// exits: returns false with an error when Vulkan is unavailable.
bool EnumerateVulkanDevices(std::vector<VulkanDeviceInfo>& devices, std::string& error);

} // namespace Libs::Graphics

#endif /* EMULATOR_INCLUDE_EMULATOR_GRAPHICS_WINDOW_H_ */
